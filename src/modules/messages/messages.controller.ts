import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ChatMessage, CreateMessageDto } from './dto/message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('channel/:channelId')
  getChannelMessages(@Param('channelId') channelId: string): ChatMessage[] {
    return this.messagesService.getChannelMessages(channelId);
  }

  @Post('channel/:channelId')
  addChannelMessage(
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ): ChatMessage {
    return this.messagesService.addChannelMessage(channelId, dto);
  }

  @Get('direct/:friendId')
  getDirectMessages(
    @Param('friendId') friendId: string,
    @Query('userId') userId?: string,
  ): ChatMessage[] {
    return this.messagesService.getDirectMessages(friendId, userId);
  }

  @Post('direct/:friendId')
  addDirectMessage(
    @Param('friendId') friendId: string,
    @Body() dto: CreateMessageDto,
  ): ChatMessage {
    return this.messagesService.addDirectMessage(friendId, dto);
  }
}
