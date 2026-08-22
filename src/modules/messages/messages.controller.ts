import { Body, Controller, Get, Param, Post, Query, Headers } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('channel/:channelId')
  async getChannelMessages(@Param('channelId') channelId: string): Promise<ChatMessage[]> {
    return this.messagesService.getChannelMessages(channelId);
  }

  @Post('channel/:channelId')
  async addChannelMessage(
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<ChatMessage> {
    if (!dto.senderId && (userId || headerUserId)) {
      dto.senderId = userId || headerUserId;
    }
    return this.messagesService.addChannelMessage(channelId, dto);
  }

  @Get('direct/:friendId')
  async getDirectMessages(
    @Param('friendId') friendId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<ChatMessage[]> {
    const effectiveUserId = userId || headerUserId;
    return this.messagesService.getDirectMessages(friendId, effectiveUserId);
  }

  @Post('direct/:friendId')
  async addDirectMessage(
    @Param('friendId') friendId: string,
    @Body() dto: CreateMessageDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<ChatMessage> {
    if (!dto.senderId && (userId || headerUserId)) {
      dto.senderId = userId || headerUserId;
    }
    return this.messagesService.addDirectMessage(friendId, dto);
  }
}

