import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Headers,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('channel/:channelId')
  async getChannelMessages(
    @Param('channelId') channelId: string,
  ): Promise<ChatMessage[]> {
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

  @Post('channel/:channelId/:messageId/reaction')
  async toggleChannelReaction(
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string; userId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean; reactions: Record<string, string[]> }> {
    const effectiveUserId = body.userId || userId || headerUserId || 'user';
    return this.messagesService.toggleChannelReaction(
      channelId,
      messageId,
      body.emoji,
      effectiveUserId,
    );
  }

  @Delete('channel/:channelId/:messageId')
  async deleteChannelMessage(
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean; messageId: string }> {
    const senderId = userId || headerUserId;
    return this.messagesService.deleteChannelMessage(channelId, messageId, senderId);
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

  @Post('direct/:friendId/:messageId/reaction')
  async toggleDirectReaction(
    @Param('friendId') friendId: string,
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string; userId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean; reactions: Record<string, string[]> }> {
    const effectiveUserId = body.userId || userId || headerUserId || 'user';
    return this.messagesService.toggleDirectReaction(
      friendId,
      messageId,
      body.emoji,
      effectiveUserId,
    );
  }

  @Delete('direct/:friendId/:messageId')
  async deleteDirectMessage(
    @Param('friendId') friendId: string,
    @Param('messageId') messageId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean; messageId: string }> {
    const senderId = userId || headerUserId;
    return this.messagesService.deleteDirectMessage(friendId, messageId, senderId);
  }
}

