import { Body, Controller, Delete, Get, Param, Post, Query, Headers } from '@nestjs/common';
import { ServersService } from './servers.service';
import { CreateChannelDto, CreateServerDto, Server, Channel } from './dto/server.dto';

@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Get()
  getAllServers(
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Server[] {
    const effectiveUserId = userId || headerUserId;
    if (effectiveUserId) {
      return this.serversService.getServersByUserId(effectiveUserId);
    }
    return this.serversService.getAllServers();
  }

  @Get(':id')
  getServerById(@Param('id') id: string): Server {
    return this.serversService.getServerById(id);
  }

  @Post()
  createServer(
    @Body() dto: CreateServerDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Server {
    const effectiveUserId = userId || headerUserId;
    if (effectiveUserId) {
      dto.creatorId = effectiveUserId;
    }
    return this.serversService.createServer(dto);
  }

  @Post(':id/channels')
  addChannel(@Param('id') serverId: string, @Body() dto: CreateChannelDto): Channel {
    return this.serversService.addChannel(serverId, dto);
  }

  @Delete(':id/channels/:channelId')
  deleteChannel(
    @Param('id') serverId: string,
    @Param('channelId') channelId: string,
  ): { success: boolean; channelId: string } {
    return this.serversService.deleteChannel(serverId, channelId);
  }

  @Get(':id/invite')
  generateInvite(
    @Param('id') serverId: string,
  ): { code: string; serverId: string; serverName: string } {
    return this.serversService.generateInviteCode(serverId);
  }

  @Post(':id/invite-friend')
  inviteFriend(
    @Param('id') serverId: string,
    @Body() body: { friendId: string; inviterId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): { success: boolean } {
    const inviterId = body.inviterId || userId || headerUserId || 'user';
    return this.serversService.inviteFriendToServer(serverId, body.friendId, inviterId);
  }

  @Post('join/:code')
  joinByCode(
    @Param('code') code: string,
    @Body() body: { userId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Server {
    const effectiveUserId = body.userId || userId || headerUserId || 'user';
    return this.serversService.joinServerByCode(code, effectiveUserId);
  }
}
