export interface MessageAttachment {
  url: string;
  name: string;
  size?: number;
  mimeType?: string;
  type?: 'image' | 'video' | 'audio' | 'file';
}

export interface MessageReplyTo {
  id: string;
  senderName: string;
  text?: string;
  type?: string;
  mediaUrl?: string | null;
}

export class ChatMessage {
  id!: string;
  senderId!: string;
  senderName!: string;
  senderAvatarUrl?: string | null;
  avatarUrl?: string | null;
  text!: string;
  timestamp!: string;
  type?: 'text' | 'image' | 'gif' | 'sticker' | 'file' | 'video' | 'audio';
  attachments?: MessageAttachment[];
  mediaUrl?: string | null;
  metadata?: Record<string, any> | null;
  replyTo?: MessageReplyTo | null;
  reactions?: Record<string, string[]>;
}

export class CreateMessageDto {
  text!: string;
  senderId?: string;
  senderName?: string;
  senderAvatarUrl?: string | null;
  avatarUrl?: string | null;
  type?: 'text' | 'image' | 'gif' | 'sticker' | 'file' | 'video' | 'audio';
  attachments?: MessageAttachment[];
  mediaUrl?: string | null;
  metadata?: Record<string, any> | null;
  replyTo?: MessageReplyTo | null;
  reactions?: Record<string, string[]>;
}


