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
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  // Map userId -> Set of socket IDs
  private readonly userSockets = new Map<string, Set<string>>();

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string || client.handshake.auth?.userId;
    if (userId) {
      this.registerUserSocket(userId, client.id);
      void client.join(`user:${userId}`);
      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
    } else {
      this.logger.log(`Client connected: ${client.id} (anonymous)`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    for (const [userId, socketIds] of this.userSockets.entries()) {
      if (socketIds.has(client.id)) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.userSockets.delete(userId);
        }
        break;
      }
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
      this.logger.log(`Socket ${client.id} authenticated as user ${data.userId}`);
    }
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (data?.roomId) {
      void client.join(data.roomId);
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
      this.logger.log(`Socket ${client.id} left room: ${data.roomId}`);
    }
  }

  private registerUserSocket(userId: string, socketId: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  // --- Realtime Broadcast Helpers ---

  broadcastChannelMessage(channelId: string, message: any) {
    this.server.to(`channel:${channelId}`).to(channelId).emit('receive_message', {
      roomId: channelId,
      channelId,
      message,
    });
    // Also emit broadcast to all for convenience if channel is public
    this.server.emit('channel_message', {
      channelId,
      message,
    });
  }

  sendDirectMessage(senderId: string, recipientId: string, message: any) {
    const dmRoom = `dm:${[senderId, recipientId].sort().join('--')}`;
    const payload = {
      roomId: recipientId, // For sender's view
      conversationId: dmRoom,
      senderId,
      recipientId,
      message,
    };

    // Emit to both user rooms
    this.server.to(`user:${senderId}`).emit('receive_message', {
      ...payload,
      targetId: recipientId,
    });
    this.server.to(`user:${recipientId}`).emit('receive_message', {
      ...payload,
      targetId: senderId,
    });

    // Also emit direct_message event
    this.server.to(`user:${senderId}`).to(`user:${recipientId}`).emit('direct_message', payload);
    // Also emit globally with conversation info so open chats receive it
    this.server.emit('dm_update', payload);
  }

  sendFriendRequestNotification(targetUserId: string, requestData: any) {
    this.server.to(`user:${targetUserId}`).emit('friend_request_received', requestData);
    this.server.emit('friend_request_event', { targetUserId, requestData });
  }

  sendFriendAcceptedNotification(userAId: string, userBId: string, data: any) {
    this.server.to(`user:${userAId}`).to(`user:${userBId}`).emit('friend_request_accepted', data);
    this.server.emit('friend_accepted_event', { userAId, userBId, data });
  }

  sendServerInviteNotification(targetUserId: string, serverData: any) {
    this.server.to(`user:${targetUserId}`).emit('server_invite_received', serverData);
    this.server.emit('server_invite_event', { targetUserId, serverData });
  }

  broadcastServerUpdate(serverData: any) {
    this.server.emit('server_updated', serverData);
  }

  broadcastUserStatusUpdate(userId: string, userDto: any) {
    if (!userDto) return;

    let rawCustom = userDto.customStatus;
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

    const emoji = typeof userDto.customStatusEmoji === 'string' ? userDto.customStatusEmoji : null;
    const text = customClean || (typeof userDto.statusMessage === 'string' ? userDto.statusMessage : null);
    const statusText = emoji && text
      ? `${emoji} ${text}`
      : (text || emoji || `@${userDto.username || 'user'}`);

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

