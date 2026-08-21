export class ChatMessage {
  id!: string;
  senderId!: string;
  senderName!: string;
  text!: string;
  timestamp!: string;
}

export class CreateMessageDto {
  text!: string;
  senderId?: string;
  senderName?: string;
}
