import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';

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

  onModuleInit() {
    this.ensureStorage();
    this.loadMessages();
  }

  private ensureStorage() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.storagePath)) {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
    }
  }

  private loadMessages() {
    try {
      const content = fs.readFileSync(this.storagePath, 'utf-8');
      this.data = JSON.parse(content);
      if (!this.data.channelMessages) this.data.channelMessages = DEFAULT_CHANNEL_MESSAGES;
      if (!this.data.directMessages) this.data.directMessages = DEFAULT_DIRECT_MESSAGES;
    } catch {
      this.data = {
        channelMessages: DEFAULT_CHANNEL_MESSAGES,
        directMessages: DEFAULT_DIRECT_MESSAGES,
      };
    }
  }

  private saveMessages() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save messages:', e);
    }
  }

  getChannelMessages(channelId: string): ChatMessage[] {
    return this.data.channelMessages[channelId] || [];
  }

  addChannelMessage(channelId: string, dto: CreateMessageDto): ChatMessage {
    const message: ChatMessage = {
      id: Date.now().toString(),
      senderId: dto.senderId || 'user',
      senderName: dto.senderName || 'Thiện Phúc',
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    if (!this.data.channelMessages[channelId]) {
      this.data.channelMessages[channelId] = [];
    }

    this.data.channelMessages[channelId].push(message);
    this.saveMessages();
    return message;
  }

  getDirectMessages(friendId: string): ChatMessage[] {
    return this.data.directMessages[friendId] || [];
  }

  addDirectMessage(friendId: string, dto: CreateMessageDto): ChatMessage {
    const message: ChatMessage = {
      id: Date.now().toString(),
      senderId: dto.senderId || 'user',
      senderName: dto.senderName || 'Thiện Phúc',
      text: dto.text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    if (!this.data.directMessages[friendId]) {
      this.data.directMessages[friendId] = [];
    }

    this.data.directMessages[friendId].push(message);
    this.saveMessages();
    return message;
  }
}
