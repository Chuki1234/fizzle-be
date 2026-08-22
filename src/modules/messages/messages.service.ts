import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';
import { EventsGateway } from '../events/events.gateway';

const DEFAULT_CHANNEL_MESSAGES: Record<string, ChatMessage[]> = {
  'c-general': [
    {
      id: '1',
      senderId: 'hoang',
      senderName: 'Hoàng Nam',
      text: 'Anh em làm xong bài tập Discrete Math chưa?',
      timestamp: '09:15 AM',
    },
  ],
  'c-java': [
    {
      id: '1',
      senderId: 'kevin',
      senderName: 'Kevin',
      text: 'Dự án DoAnCuoiKi đang bị lỗi file path này Phúc ơi!',
      timestamp: '10:00 AM',
    },
  ],
};

const DEFAULT_DIRECT_MESSAGES: Record<string, ChatMessage[]> = {
  kevin: [
    {
      id: '1',
      senderId: 'kevin',
      senderName: 'Kevin',
      text: 'Chiều nay ghé Highlands học tiếp không Phúc?',
      timestamp: '10:45 AM',
    },
  ],
  bao: [
    {
      id: '1',
      senderId: 'bao',
      senderName: 'Gia Bảo',
      text: 'Chiều nay ghé Highlands học tiếp không Phúc?',
      timestamp: '10:45 AM',
    },
  ],
};

import { SupabaseService } from '../../infra/supabase/supabase.service';

interface StoredMessagesData {
  channelMessages: Record<string, ChatMessage[]>;
  directMessages: Record<string, ChatMessage[]>;
}

@Injectable()
export class MessagesService implements OnModuleInit {
  private readonly storagePath = path.resolve(process.cwd(), 'data', 'messages.json');
  private data: StoredMessagesData = {
    channelMessages: DEFAULT_CHANNEL_MESSAGES,
    directMessages: DEFAULT_DIRECT_MESSAGES,
  };

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.ensureStorage();
    this.loadMessages();
  }

  private ensureStorage() {
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
  }

  private loadMessages() {
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
  }

  private saveMessages() {
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
  }

  getChannelMessages(channelId: string): ChatMessage[] {
    return this.data.channelMessages[channelId] || [];
  }

  async addChannelMessageAsync(channelId: string, dto: CreateMessageDto): Promise<ChatMessage> {
    return this.addChannelMessage(channelId, dto);
  }

  addChannelMessage(channelId: string, dto: CreateMessageDto): ChatMessage {
    const senderId = dto.senderId || 'user';
    const avatarUrl = dto.senderAvatarUrl || dto.avatarUrl || null;

    const message: ChatMessage = {
      id: Date.now().toString(),
      senderId: senderId,
      senderName: dto.senderName || 'Thiện Phúc',
      senderAvatarUrl: avatarUrl,
      avatarUrl: avatarUrl,
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Asynchronously resolve avatar from Supabase profiles if not present
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

    if (!this.data.channelMessages[channelId]) {
      this.data.channelMessages[channelId] = [];
    }

    this.data.channelMessages[channelId].push(message);

    // Persist to Supabase if table exists
    void (async () => {
      try {
        await this.supabase.admin
          .from('messages')
          .insert({
            channel_id: channelId,
            sender_id: senderId,
            sender_name: message.senderName,
            text: message.text,
            sender_avatar_url: avatarUrl,
          });
      } catch {
        // ignore
      }
    })();

    // Broadcast in real-time
    try {
      this.eventsGateway.broadcastChannelMessage(channelId, message);
    } catch (e) {
      console.warn('Could not broadcast channel message via socket:', e);
    }

    return message;
  }

  getDirectMessages(friendId: string, currentUserId?: string): ChatMessage[] {
    if (currentUserId && friendId) {
      const pairKey = [currentUserId, friendId].sort().join('--');
      if (this.data.directMessages[pairKey] && this.data.directMessages[pairKey].length > 0) {
        return this.data.directMessages[pairKey];
      }
    }
    return this.data.directMessages[friendId] || [];
  }

  addDirectMessage(friendId: string, dto: CreateMessageDto): ChatMessage {
    const senderId = dto.senderId || 'user';
    const avatarUrl = dto.senderAvatarUrl || dto.avatarUrl || null;

    const message: ChatMessage = {
      id: Date.now().toString(),
      senderId: senderId,
      senderName: dto.senderName || 'Thiện Phúc',
      senderAvatarUrl: avatarUrl,
      avatarUrl: avatarUrl,
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Asynchronously resolve avatar from Supabase profiles if not present
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

    const pairKey = [senderId, friendId].sort().join('--');

    if (!this.data.directMessages[pairKey]) {
      this.data.directMessages[pairKey] = [];
    }
    this.data.directMessages[pairKey].push(message);

    // Also sync to single-key for fallback
    if (!this.data.directMessages[friendId]) {
      this.data.directMessages[friendId] = [];
    }
    if (!this.data.directMessages[friendId].some((m) => m.id === message.id)) {
      this.data.directMessages[friendId].push(message);
    }

    // Persist to Supabase if direct_messages table exists
    void (async () => {
      try {
        await this.supabase.admin
          .from('direct_messages')
          .insert({
            sender_id: senderId,
            recipient_id: friendId,
            sender_name: message.senderName,
            text: message.text,
            sender_avatar_url: avatarUrl,
          });
      } catch {
        // ignore
      }
    })();

    // Broadcast in real-time to both users
    try {
      this.eventsGateway.sendDirectMessage(senderId, friendId, message);
    } catch (e) {
      console.warn('Could not broadcast direct message via socket:', e);
    }

    return message;
  }
}
