import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';
import { EventsGateway } from '../events/events.gateway';
import { SupabaseService } from '../../infra/supabase/supabase.service';

@Injectable()
export class MessagesService {
  // In-memory runtime cache
  private memoryChannelMessages: Record<string, ChatMessage[]> = {};
  private memoryDirectMessages: Record<string, ChatMessage[]> = {};

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
        const msgs: ChatMessage[] = data.map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name || 'Người dùng',
          text: m.text,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));
        this.memoryChannelMessages[channelId] = msgs;
        return msgs;
      }
    } catch (e) {
      console.warn('Supabase getChannelMessages failed, using memory fallback:', e);
    }

    return this.memoryChannelMessages[channelId] || [];
  }

  async addChannelMessage(channelId: string, dto: CreateMessageDto): Promise<ChatMessage> {
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    const message: ChatMessage = {
      id,
      senderId: dto.senderId || 'user',
      senderName: dto.senderName || 'Người dùng',
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // 1. Try insert into Supabase DB
    try {
      await this.supabase.admin.from('channel_messages').insert({
        id,
        channel_id: channelId,
        sender_id: dto.senderId && dto.senderId !== 'user' ? dto.senderId : null,
        sender_name: message.senderName,
        text: message.text,
        created_at: createdAt,
      });
    } catch (e) {
      console.warn('Supabase insert channel_messages failed:', e);
    }

    // 2. Memory cache update
    if (!this.memoryChannelMessages[channelId]) {
      this.memoryChannelMessages[channelId] = [];
    }
    this.memoryChannelMessages[channelId].push(message);

    // 3. Broadcast in real-time
    try {
      this.eventsGateway.broadcastChannelMessage(channelId, message);
    } catch (e) {
      console.warn('Could not broadcast channel message via socket:', e);
    }

    return message;
  }

  async getDirectMessages(friendId: string, currentUserId?: string): Promise<ChatMessage[]> {
    if (!friendId) return [];

    try {
      let query = this.supabase.admin
        .from('direct_messages')
        .select('*')
        .order('created_at', { ascending: true });

      if (currentUserId && friendId) {
        query = query.or(
          `and(sender_id.eq.${currentUserId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${currentUserId})`,
        );
      } else {
        query = query.or(`sender_id.eq.${friendId},recipient_id.eq.${friendId}`);
      }

      const { data, error } = await query;
      if (!error && data) {
        const msgs: ChatMessage[] = data.map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name || 'Người dùng',
          text: m.text,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));

        if (currentUserId && friendId) {
          const pairKey = [currentUserId, friendId].sort().join('--');
          this.memoryDirectMessages[pairKey] = msgs;
        }
        return msgs;
      }
    } catch (e) {
      console.warn('Supabase getDirectMessages failed, using memory fallback:', e);
    }

    // Memory fallback
    if (currentUserId && friendId) {
      const pairKey = [currentUserId, friendId].sort().join('--');
      if (this.memoryDirectMessages[pairKey] && this.memoryDirectMessages[pairKey].length > 0) {
        return this.memoryDirectMessages[pairKey];
      }
    }
    return this.memoryDirectMessages[friendId] || [];
  }

  async addDirectMessage(friendId: string, dto: CreateMessageDto): Promise<ChatMessage> {
    const senderId = dto.senderId || 'user';
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    const message: ChatMessage = {
      id,
      senderId: senderId,
      senderName: dto.senderName || 'Người dùng',
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // 1. Try insert into Supabase DB
    try {
      await this.supabase.admin.from('direct_messages').insert({
        id,
        sender_id: senderId,
        recipient_id: friendId,
        sender_name: message.senderName,
        text: message.text,
        created_at: createdAt,
      });
    } catch (e) {
      console.warn('Supabase insert direct_messages failed:', e);
    }

    // 2. Memory cache update
    const pairKey = [senderId, friendId].sort().join('--');
    if (!this.memoryDirectMessages[pairKey]) {
      this.memoryDirectMessages[pairKey] = [];
    }
    this.memoryDirectMessages[pairKey].push(message);

    if (!this.memoryDirectMessages[friendId]) {
      this.memoryDirectMessages[friendId] = [];
    }
    if (!this.memoryDirectMessages[friendId].some((m) => m.id === message.id)) {
      this.memoryDirectMessages[friendId].push(message);
    }

    // 3. Broadcast in real-time to both users
    try {
      this.eventsGateway.sendDirectMessage(senderId, friendId, message);
    } catch (e) {
      console.warn('Could not broadcast direct message via socket:', e);
    }

    return message;
  }
}

