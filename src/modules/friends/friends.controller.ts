import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { FriendUser, SendFriendRequestDto } from './dto/friend.dto';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  async getFriends(
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<FriendUser[]> {
    const effectiveUserId = userId || headerUserId || 'user';
    return this.friendsService.getUserFriends(effectiveUserId);
  }

  @Get('search')
  async searchUsers(
    @Query('q') query: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<FriendUser[]> {
    const effectiveUserId = userId || headerUserId || 'user';
    return this.friendsService.searchUsers(query, effectiveUserId);
  }

  @Post('request')
  async sendFriendRequest(
    @Body() dto: SendFriendRequestDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ) {
    const effectiveSenderId = dto.senderId || userId || headerUserId || 'user';
    return this.friendsService.sendFriendRequest(effectiveSenderId, dto);
  }

  @Post(':id/accept')
  async acceptFriend(
    @Param('id') friendId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ) {
    const effectiveUserId = userId || headerUserId || 'user';
    return this.friendsService.acceptFriendRequest(effectiveUserId, friendId);
  }

  @Post(':id/reject')
  async rejectFriend(
    @Param('id') friendId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ) {
    const effectiveUserId = userId || headerUserId || 'user';
    return this.friendsService.rejectFriendRequest(effectiveUserId, friendId);
  }

  @Delete(':id')
  async removeFriend(
    @Param('id') friendId: string,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ) {
    const effectiveUserId = userId || headerUserId || 'user';
    return this.friendsService.removeFriend(effectiveUserId, friendId);
  }
}
