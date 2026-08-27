import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SupabaseService } from '../../infra/supabase/supabase.service';

export interface VoiceParticipant {
  socketId: string;
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
}

@WebSocketGateway({
  cors: {
    origin: (origin: any, callback: any) => {
      callback(null, true);
    },
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(@Optional() private readonly supabase?: SupabaseService) {}

  // Map userId -> Set of socket IDs
  private readonly userSockets = new Map<string, Set<string>>();
  // Map socketId -> userId
  private readonly socketUser = new Map<string, string>();
  // Map channelId -> Map<socketId, VoiceParticipant>
  private readonly voiceRooms = new Map<
    string,
    Map<string, VoiceParticipant>
  >();
  // Map socketId -> channelId for quick voice lookup
  private readonly socketVoiceChannel = new Map<string, string>();

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    const userId =
      (client.handshake.query.userId as string) ||
      client.handshake.auth?.userId;
    if (userId) {
      this.registerUserSocket(userId, client.id);
      void client.join(`user:${userId}`);
      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
    } else {
      this.logger.log(`Client connected: ${client.id} (anonymous)`);
    }
    // Gửi ngay trạng thái các kênh voice cho client vừa kết nối
    client.emit('voice_channels_state_update', this.getAllVoiceRoomsState());
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Voice cleanup
    this.handleLeaveVoice(client);

    const userId = this.socketUser.get(client.id);
    if (userId) {
      const socketIds = this.userSockets.get(userId);
      if (socketIds) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.socketUser.delete(client.id);
    }
  }

  @SubscribeMessage('authenticate')
  handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (data?.userId) {
      this.registerUserSocket(data.userId, client.id);
      void client.join(`user:${data.userId}`);
      this.logger.log(
        `Socket ${client.id} authenticated as user ${data.userId}`,
      );
      // Gửi trạng thái kênh voice cho client
      client.emit('voice_channels_state_update', this.getAllVoiceRoomsState());
    }
  }


  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (data?.roomId) {
      void client.join(data.roomId);
      void client.join(`channel:${data.roomId}`);
      this.logger.log(`Socket ${client.id} joined room: ${data.roomId}`);
    }
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (data?.roomId) {
      void client.leave(data.roomId);
      void client.leave(`channel:${data.roomId}`);
      this.logger.log(`Socket ${client.id} left room: ${data.roomId}`);
    }
  }

  // ==========================================
  // --- WEBRTC VOICE SIGNALING HANDLERS ---
  // ==========================================

  @SubscribeMessage('voice_join')
  async handleJoinVoice(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {

      channelId: string;
      userId: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string | null;
    },
  ) {
    if (!data?.channelId || !data?.userId) return;

    // Leave any prior voice channel first
    this.handleLeaveVoice(client);

    const channelId = data.channelId;
    const roomKey = `voice:${channelId}`;

    void client.join(roomKey);
    this.socketVoiceChannel.set(client.id, channelId);

    let avatarUrl = data.avatarUrl || null;
    let displayName = data.displayName || data.username || 'Người dùng';
    let username = data.username || 'user';

    // Auto-fetch profile from Supabase if avatarUrl is missing
    if (!avatarUrl && data.userId && this.supabase?.admin) {
      try {
        const { data: profile } = await this.supabase.admin
          .from('profiles')
          .select('avatar_url, display_name, username')
          .eq('id', data.userId)
          .single();
        if (profile) {
          if (profile.avatar_url) avatarUrl = profile.avatar_url;
          if (profile.display_name) displayName = profile.display_name;
          if (profile.username) username = profile.username;
        }
      } catch {
        // ignore
      }
    }


    const participant: VoiceParticipant = {
      socketId: client.id,
      userId: data.userId,
      username,
      displayName,
      avatarUrl,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
    };

    const roomParticipants = this.voiceRooms.get(channelId)!;

    // Existing participants list to send to the newly joined peer
    const existingList = Array.from(roomParticipants.values());

    roomParticipants.set(client.id, participant);

    // 1. Send existing participants to the joined user
    client.emit('voice_room_users', {
      channelId,
      users: existingList,
    });

    // 2. Broadcast new user joined to other members in the voice room
    client.to(roomKey).emit('voice_user_joined', {
      channelId,
      user: participant,
    });

    // 3. Broadcast global voice channels state to ALL clients (for sidebar live member list)
    this.broadcastVoiceChannelsState();

    this.logger.log(
      `User ${data.userId} (${client.id}) joined voice channel: ${channelId}`,
    );
  }

  @SubscribeMessage('voice_leave')
  handleLeaveVoice(@ConnectedSocket() client: Socket) {
    const channelId = this.socketVoiceChannel.get(client.id);
    if (!channelId) return;

    const roomKey = `voice:${channelId}`;
    const roomParticipants = this.voiceRooms.get(channelId);

    if (roomParticipants) {
      const participant = roomParticipants.get(client.id);
      roomParticipants.delete(client.id);

      if (participant) {
        client.to(roomKey).emit('voice_user_left', {
          channelId,
          socketId: client.id,
          userId: participant.userId,
        });
      }

      if (roomParticipants.size === 0) {
        this.voiceRooms.delete(channelId);
      }
    }

    void client.leave(roomKey);
    this.socketVoiceChannel.delete(client.id);

    // Broadcast global voice channels state to ALL clients
    this.broadcastVoiceChannelsState();

    this.logger.log(`Socket ${client.id} left voice channel ${channelId}`);
  }

  @SubscribeMessage('voice_signal')
  handleVoiceSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetSocketId: string;
      signal: any;
      type: 'offer' | 'answer' | 'ice-candidate';
    },
  ) {
    if (!data?.targetSocketId || !data?.signal) return;

    const fromUserId = this.socketUser.get(client.id) || client.id;
    this.server.to(data.targetSocketId).emit('voice_signal', {
      senderSocketId: client.id,
      senderUserId: fromUserId,
      signal: data.signal,
      type: data.type,
    });
  }

  @SubscribeMessage('voice_state')
  handleVoiceState(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      isMuted?: boolean;
      isDeafened?: boolean;
      isSpeaking?: boolean;
    },
  ) {
    const channelId = this.socketVoiceChannel.get(client.id);
    if (!channelId) return;

    const roomParticipants = this.voiceRooms.get(channelId);
    if (!roomParticipants) return;

    const participant = roomParticipants.get(client.id);
    if (!participant) return;

    if (data.isMuted !== undefined) participant.isMuted = data.isMuted;
    if (data.isDeafened !== undefined) participant.isDeafened = data.isDeafened;
    if (data.isSpeaking !== undefined) participant.isSpeaking = data.isSpeaking;

    const roomKey = `voice:${channelId}`;
    this.server.to(roomKey).emit('voice_user_state_updated', {
      channelId,
      socketId: client.id,
      userId: participant.userId,
      isMuted: participant.isMuted,
      isDeafened: participant.isDeafened,
      isSpeaking: participant.isSpeaking,
    });

    // Also update global channels state for sidebar speaking glow & mute icon
    this.broadcastVoiceChannelsState();
  }

  @SubscribeMessage('request_voice_states')
  handleRequestVoiceStates(@ConnectedSocket() client: Socket) {
    client.emit('voice_channels_state_update', this.getAllVoiceRoomsState());
  }

  private getAllVoiceRoomsState(): Record<string, VoiceParticipant[]> {
    const result: Record<string, VoiceParticipant[]> = {};
    for (const [chId, map] of this.voiceRooms.entries()) {
      result[chId] = Array.from(map.values());
    }
    return result;
  }

  private broadcastVoiceChannelsState() {
    this.server.emit('voice_channels_state_update', this.getAllVoiceRoomsState());
  }

  private registerUserSocket(userId: string, socketId: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
    this.socketUser.set(socketId, userId);
  }

  // --- Realtime Broadcast Helpers ---

  broadcastChannelMessage(channelId: string, message: any) {
    // Emit to channel room subscribers
    this.server
      .to(`channel:${channelId}`)
      .to(channelId)
      .emit('receive_message', {
        roomId: channelId,
        channelId,
        message,
      });
    // Also emit broadcast channel_message event for active clients
    this.server.emit('channel_message', {
      channelId,
      message,
    });
  }

  sendDirectMessage(senderId: string, recipientId: string, message: any) {
    const dmRoom = `dm:${[senderId, recipientId].sort().join('--')}`;
    const payload = {
      roomId: recipientId,
      conversationId: dmRoom,
      senderId,
      recipientId,
      message,
    };

    // Emit to sender socket rooms
    this.server.to(`user:${senderId}`).emit('receive_message', {
      ...payload,
      targetId: recipientId,
    });
    // Emit to recipient socket rooms
    this.server.to(`user:${recipientId}`).emit('receive_message', {
      ...payload,
      targetId: senderId,
    });

    // Also emit direct_message event specifically to both users
    this.server
      .to(`user:${senderId}`)
      .to(`user:${recipientId}`)
      .emit('direct_message', payload);
  }

  sendFriendRequestNotification(targetUserId: string, requestData: any) {
    this.server
      .to(`user:${targetUserId}`)
      .emit('friend_request_received', requestData);
    this.server.emit('friend_request_event', { targetUserId, requestData });
  }

  sendFriendAcceptedNotification(userAId: string, userBId: string, data: any) {
    this.server
      .to(`user:${userAId}`)
      .to(`user:${userBId}`)
      .emit('friend_request_accepted', data);
    this.server.emit('friend_accepted_event', { userAId, userBId, data });
  }

  sendServerInviteNotification(targetUserId: string, serverData: any) {
    this.server
      .to(`user:${targetUserId}`)
      .emit('server_invite_received', serverData);
    this.server.emit('server_invite_event', { targetUserId, serverData });
  }

  broadcastServerUpdate(serverData: any) {
    this.server.emit('server_updated', serverData);
  }

  // --- Typing indicator handlers ---

  @SubscribeMessage('channel_typing')
  handleChannelTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      channelId: string;
      userId: string;
      displayName: string;
      isTyping: boolean;
    },
  ) {
    if (!data?.channelId) return;
    this.server
      .to(`channel:${data.channelId}`)
      .to(data.channelId)
      .emit('channel_typing', data);
    this.server.emit('channel_typing', data);
  }

  @SubscribeMessage('dm_typing')
  handleDmTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      recipientId: string;
      userId: string;
      displayName: string;
      isTyping: boolean;
    },
  ) {
    if (!data?.recipientId) return;
    this.server.to(`user:${data.recipientId}`).emit('dm_typing', data);
    this.server.to(`user:${data.userId}`).emit('dm_typing', data);
  }

  // --- Message Reaction Broadcasts ---

  broadcastChannelReaction(
    channelId: string,
    messageId: string,
    reactions: Record<string, string[]>,
  ) {
    const payload = { channelId, messageId, reactions };
    this.server
      .to(`channel:${channelId}`)
      .to(channelId)
      .emit('channel_message_reaction', payload);
    this.server.emit('channel_message_reaction', payload);
  }

  sendDirectReaction(
    senderId: string,
    recipientId: string,
    messageId: string,
    reactions: Record<string, string[]>,
  ) {
    const payload = { senderId, recipientId, messageId, reactions };
    this.server.to(`user:${senderId}`).emit('direct_message_reaction', payload);
    this.server.to(`user:${recipientId}`).emit('direct_message_reaction', payload);
    this.server.emit('direct_message_reaction', payload);
  }

  // --- Message Delete Broadcasts ---

  broadcastChannelMessageDeleted(channelId: string, messageId: string) {
    this.server
      .to(`channel:${channelId}`)
      .to(channelId)
      .emit('channel_message_deleted', { channelId, messageId });
    this.server.emit('channel_message_deleted', { channelId, messageId });
  }

  sendDirectMessageDeleted(
    senderId: string,
    recipientId: string,
    messageId: string,
  ) {
    const payload = { senderId, recipientId, friendId: senderId, messageId };
    this.server.to(`user:${senderId}`).emit('direct_message_deleted', payload);
    this.server.to(`user:${recipientId}`).emit('direct_message_deleted', payload);
    this.server.emit('direct_message_deleted', payload);
  }

  broadcastUserStatusUpdate(userId: string, userDto: any) {
    if (!userDto) return;

    const rawCustom = userDto.customStatus;
    let customClean: string | null = null;

    if (typeof rawCustom === 'string') {
      const trimmed = rawCustom.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          customClean = parsed.customStatus || parsed.statusMessage || null;
        } catch {
          customClean = null;
        }
      } else {
        customClean = trimmed;
      }
    }

    const emoji =
      typeof userDto.customStatusEmoji === 'string'
        ? userDto.customStatusEmoji
        : null;
    const text =
      customClean ||
      (typeof userDto.statusMessage === 'string'
        ? userDto.statusMessage
        : null);
    const statusText = emoji && text ? `${emoji} ${text}` : text || emoji || '';

    const payload = {
      userId,
      id: userId,
      username: userDto.username,
      displayName: userDto.displayName,
      avatarUrl: userDto.avatarUrl,
      bannerUrl: userDto.bannerUrl,
      presence: userDto.presence || 'online',
      customStatus: customClean,
      customStatusEmoji: emoji,
      statusMessage: userDto.statusMessage,
      statusText,
      aboutMe: userDto.aboutMe,
      bannerColor: userDto.bannerColor,
      avatarFrame: userDto.avatarFrame,
    };

    if (this.server) {
      this.server.emit('user_status_updated', payload);
    }
  }
}
