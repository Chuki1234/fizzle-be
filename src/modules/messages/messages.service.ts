import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';
import { EventsGateway } from '../events/events.gateway';
import { SupabaseService } from '../../infra/supabase/supabase.service';

function serializeMessageContent(dto: CreateMessageDto): string {
  if (
    dto.attachments?.length ||
    dto.mediaUrl ||
    (dto.type && dto.type !== 'text') ||
    dto.metadata ||
    dto.replyTo ||
    dto.reactions
  ) {
    return JSON.stringify({
      __isRichMessage: true,
      text: dto.text || '',
      type: dto.type || 'text',
      mediaUrl: dto.mediaUrl || null,
      attachments: dto.attachments || [],
      metadata: dto.metadata || null,
      replyTo: dto.replyTo || null,
      reactions: dto.reactions || {},
    });
  }
  return dto.text || '';
}

function parseMessageContent(rawText: string): {
  text: string;
  type?: 'text' | 'image' | 'gif' | 'sticker' | 'file' | 'video' | 'audio';
  mediaUrl?: string | null;
  attachments?: any[];
  metadata?: any;
  replyTo?: any;
  reactions?: Record<string, string[]>;
} {
  if (!rawText) return { text: '' };
  if (rawText.startsWith('{"__isRichMessage":true') || rawText.includes('"__isRichMessage":true')) {
    try {
      const parsed = JSON.parse(rawText);
      return {
        text: parsed.text || '',
        type: parsed.type || 'text',
        mediaUrl: parsed.mediaUrl || null,
        attachments: parsed.attachments || [],
        metadata: parsed.metadata || null,
        replyTo: parsed.replyTo || null,
        reactions: parsed.reactions || {},
      };
    } catch {
      return { text: rawText };
    }
  }
  return { text: rawText };
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  async getChannelMessages(channelId: string): Promise<ChatMessage[]> {
    if (!channelId) return [];

    try {
      const { data, error } = await this.supabase.admin
        .from('channel_messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        const msgs: ChatMessage[] = data.map((m) => {
          const parsed = parseMessageContent(m.text);
          return {
            id: m.id,
            senderId: m.sender_id,
            senderName: m.sender_name || 'Người dùng',
            text: parsed.text,
            type: parsed.type,
            mediaUrl: parsed.mediaUrl,
            attachments: parsed.attachments,
            metadata: parsed.metadata,
            replyTo: parsed.replyTo,
            reactions: parsed.reactions,
            timestamp: new Date(m.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          };
        });
        return msgs;
      }
    } catch (e) {
      console.warn('Supabase getChannelMessages failed:', e);
    }

    return [];
  }

  async addChannelMessage(
    channelId: string,
    dto: CreateMessageDto,
  ): Promise<ChatMessage> {
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    const senderId = dto.senderId || 'user';
    const avatarUrl = dto.senderAvatarUrl || dto.avatarUrl || null;
    const message: ChatMessage = {
      id,
      senderId,
      senderName: dto.senderName || 'Người dùng',
      senderAvatarUrl: avatarUrl,
      avatarUrl,
      text: (dto.text || '').trim(),
      type: dto.type || 'text',
      attachments: dto.attachments || [],
      mediaUrl: dto.mediaUrl || null,
      metadata: dto.metadata || null,
      replyTo: dto.replyTo || null,
      reactions: dto.reactions || {},
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    // Resolve avatar / display name from Supabase profiles if not provided
    if (!avatarUrl && senderId && senderId !== 'user') {
      void (async () => {
        try {
          const { data } = await this.supabase.admin
            .from('profiles')
            .select('avatar_url, display_name')
            .eq('id', senderId)
            .single();
          if (data?.avatar_url) {
            message.senderAvatarUrl = data.avatar_url;
            message.avatarUrl = data.avatar_url;
          }
          if (data?.display_name) {
            message.senderName = data.display_name;
          }
        } catch {
          // ignore
        }
      })();
    }

    // 1. Try insert into Supabase DB
    try {
      const dbText = serializeMessageContent(dto);
      await this.supabase.admin.from('channel_messages').insert({
        id,
        channel_id: channelId,
        sender_id:
          dto.senderId && dto.senderId !== 'user' ? dto.senderId : null,
        sender_name: message.senderName,
        text: dbText,
        created_at: createdAt,
      });
    } catch (e) {
      console.warn('Supabase insert channel_messages failed:', e);
    }

    // 2. Broadcast in real-time
    try {
      this.eventsGateway.broadcastChannelMessage(channelId, message);
    } catch (e) {
      console.warn('Could not broadcast channel message via socket:', e);
    }

    return message;
  }

  async getDirectMessages(
    friendId: string,
    currentUserId?: string,
  ): Promise<ChatMessage[]> {
    if (!friendId) return [];

    try {
      let query = this.supabase.admin
        .from('direct_messages')
        .select('*')
        .order('created_at', { ascending: true });

      if (currentUserId && friendId) {
        query = query.or(
          `sender_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`,
        );
      } else {
        query = query.or(
          `sender_id.eq.${friendId},recipient_id.eq.${friendId}`,
        );
      }

      const { data, error } = await query;
      if (!error && data) {
        const filtered = currentUserId
          ? data.filter(
              (m) =>
                (m.sender_id === currentUserId &&
                  m.recipient_id === friendId) ||
                (m.sender_id === friendId && m.recipient_id === currentUserId),
            )
          : data;

        const msgs: ChatMessage[] = filtered.map((m) => {
          const parsed = parseMessageContent(m.text);
          return {
            id: m.id,
            senderId: m.sender_id,
            senderName: m.sender_name || 'Người dùng',
            text: parsed.text,
            type: parsed.type,
            mediaUrl: parsed.mediaUrl,
            attachments: parsed.attachments,
            metadata: parsed.metadata,
            replyTo: parsed.replyTo,
            reactions: parsed.reactions,
            timestamp: new Date(m.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          };
        });
        return msgs;
      }
    } catch (e) {
      console.warn('Supabase getDirectMessages failed:', e);
    }

    return [];
  }

  async addDirectMessage(
    friendId: string,
    dto: CreateMessageDto,
  ): Promise<ChatMessage> {
    const senderId = dto.senderId || 'user';
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    const avatarUrl = dto.senderAvatarUrl || dto.avatarUrl || null;
    const message: ChatMessage = {
      id,
      senderId,
      senderName: dto.senderName || 'Người dùng',
      senderAvatarUrl: avatarUrl,
      avatarUrl,
      text: (dto.text || '').trim(),
      type: dto.type || 'text',
      attachments: dto.attachments || [],
      mediaUrl: dto.mediaUrl || null,
      metadata: dto.metadata || null,
      replyTo: dto.replyTo || null,
      reactions: dto.reactions || {},
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    // Resolve avatar / display name from Supabase profiles if not provided
    if (!avatarUrl && senderId && senderId !== 'user') {
      void (async () => {
        try {
          const { data } = await this.supabase.admin
            .from('profiles')
            .select('avatar_url, display_name')
            .eq('id', senderId)
            .single();
          if (data?.avatar_url) {
            message.senderAvatarUrl = data.avatar_url;
            message.avatarUrl = data.avatar_url;
          }
          if (data?.display_name) {
            message.senderName = data.display_name;
          }
        } catch {
          // ignore
        }
      })();
    }

    // 1. Try insert into Supabase DB
    try {
      const dbText = serializeMessageContent(dto);
      const { error } = await this.supabase.admin
        .from('direct_messages')
        .insert({
          id,
          sender_id: senderId,
          recipient_id: friendId,
          sender_name: message.senderName,
          text: dbText,
          created_at: createdAt,
        });
      if (error) {
        console.warn('Supabase insert direct_messages error:', error);
      }
    } catch (e) {
      console.warn('Supabase insert direct_messages failed:', e);
    }

    // 2. Broadcast in real-time to both users
    try {
      this.eventsGateway.sendDirectMessage(senderId, friendId, message);
    } catch (e) {
      console.warn('Could not broadcast direct message via socket:', e);
    }

    return message;
  }

  async toggleChannelReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<{ success: boolean; reactions: Record<string, string[]> }> {
    let updatedReactions: Record<string, string[]> = {};

    try {
      const { data } = await this.supabase.admin
        .from('channel_messages')
        .select('*')
        .eq('id', messageId)
        .eq('channel_id', channelId)
        .single();

      if (data) {
        const parsed = parseMessageContent(data.text);
        const reactions = { ...(parsed.reactions || {}) };
        const userList = reactions[emoji] ? [...reactions[emoji]] : [];

        const index = userList.indexOf(userId);
        if (index > -1) {
          userList.splice(index, 1);
        } else {
          userList.push(userId);
        }

        if (userList.length === 0) {
          delete reactions[emoji];
        } else {
          reactions[emoji] = userList;
        }

        updatedReactions = reactions;

        const updatedDto: CreateMessageDto = {
          text: parsed.text,
          type: parsed.type,
          mediaUrl: parsed.mediaUrl,
          attachments: parsed.attachments,
          metadata: parsed.metadata,
          replyTo: parsed.replyTo,
          reactions: updatedReactions,
        };

        const newDbText = serializeMessageContent(updatedDto);
        await this.supabase.admin
          .from('channel_messages')
          .update({ text: newDbText })
          .eq('id', messageId);
      }
    } catch (e) {
      console.warn('Supabase toggle channel reaction error:', e);
    }

    try {
      this.eventsGateway.broadcastChannelReaction(
        channelId,
        messageId,
        updatedReactions,
      );
    } catch (e) {
      console.warn('Socket broadcast channel reaction error:', e);
    }

    return { success: true, reactions: updatedReactions };
  }

  async toggleDirectReaction(
    friendId: string,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<{ success: boolean; reactions: Record<string, string[]> }> {
    let updatedReactions: Record<string, string[]> = {};
    let senderId = userId;
    let recipientId = friendId;

    try {
      const { data } = await this.supabase.admin
        .from('direct_messages')
        .select('*')
        .eq('id', messageId)
        .single();

      if (data) {
        senderId = data.sender_id;
        recipientId = data.recipient_id;
        const parsed = parseMessageContent(data.text);
        const reactions = { ...(parsed.reactions || {}) };
        const userList = reactions[emoji] ? [...reactions[emoji]] : [];

        const index = userList.indexOf(userId);
        if (index > -1) {
          userList.splice(index, 1);
        } else {
          userList.push(userId);
        }

        if (userList.length === 0) {
          delete reactions[emoji];
        } else {
          reactions[emoji] = userList;
        }

        updatedReactions = reactions;

        const updatedDto: CreateMessageDto = {
          text: parsed.text,
          type: parsed.type,
          mediaUrl: parsed.mediaUrl,
          attachments: parsed.attachments,
          metadata: parsed.metadata,
          replyTo: parsed.replyTo,
          reactions: updatedReactions,
        };

        const newDbText = serializeMessageContent(updatedDto);
        await this.supabase.admin
          .from('direct_messages')
          .update({ text: newDbText })
          .eq('id', messageId);
      }
    } catch (e) {
      console.warn('Supabase toggle direct reaction error:', e);
    }

    try {
      this.eventsGateway.sendDirectReaction(
        senderId,
        recipientId,
        messageId,
        updatedReactions,
      );
    } catch (e) {
      console.warn('Socket send direct reaction error:', e);
    }

    return { success: true, reactions: updatedReactions };
  }

  async deleteChannelMessage(
    channelId: string,
    messageId: string,
    senderId?: string,
  ): Promise<{ success: boolean; messageId: string }> {
    try {
      let query = this.supabase.admin
        .from('channel_messages')
        .delete()
        .eq('id', messageId)
        .eq('channel_id', channelId);

      if (senderId && senderId !== 'user') {
        query = query.eq('sender_id', senderId);
      }

      await query;
    } catch (e) {
      console.warn('Supabase delete channel_message failed:', e);
    }

    try {
      this.eventsGateway.broadcastChannelMessageDeleted(channelId, messageId);
    } catch (e) {
      console.warn('Could not broadcast channel message deletion via socket:', e);
    }

    return { success: true, messageId };
  }

  async deleteDirectMessage(
    friendId: string,
    messageId: string,
    senderId?: string,
  ): Promise<{ success: boolean; messageId: string }> {
    try {
      let query = this.supabase.admin
        .from('direct_messages')
        .delete()
        .eq('id', messageId);

      if (senderId && senderId !== 'user') {
        query = query.eq('sender_id', senderId);
      }

      await query;
    } catch (e) {
      console.warn('Supabase delete direct_message failed:', e);
    }

    try {
      this.eventsGateway.sendDirectMessageDeleted(
        senderId || 'user',
        friendId,
        messageId,
      );
    } catch (e) {
      console.warn('Could not broadcast direct message deletion via socket:', e);
    }

    return { success: true, messageId };
  }
}


