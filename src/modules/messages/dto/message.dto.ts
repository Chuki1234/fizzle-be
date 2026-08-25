export interface MessageAttachment {
  url: string;
  name: string;
  size?: number;
  mimeType?: string;
  type?: 'image' | 'video' | 'audio' | 'file';
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
}

