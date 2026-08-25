export class ChatMessage {
  id!: string;
  senderId!: string;
  senderName!: string;
  senderAvatarUrl?: string | null;
  avatarUrl?: string | null;
  text!: string;
  timestamp!: string;
}

export class CreateMessageDto {
  text!: string;
  senderId?: string;
  senderName?: string;
  senderAvatarUrl?: string | null;
  avatarUrl?: string | null;
}
