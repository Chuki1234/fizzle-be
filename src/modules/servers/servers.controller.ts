import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Headers,
} from '@nestjs/common';
import { ServersService } from './servers.service';
import {
  CreateChannelDto,
  CreateServerDto,
  UpdateServerDto,
  Server,
  Channel,
} from './dto/server.dto';

@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Get()
  async getAllServers(
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<Server[]> {
    const effectiveUserId = userId || headerUserId;
    if (effectiveUserId) {
      return this.serversService.getServersByUserId(effectiveUserId);
    }
    return this.serversService.getAllServers();
  }

  @Get(':id')
  async getServerById(@Param('id') id: string): Promise<Server> {
    return this.serversService.getServerById(id);
  }

  @Post()
  async createServer(
    @Body() dto: CreateServerDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<Server> {
    const effectiveUserId = userId || headerUserId;
    if (effectiveUserId) {
      dto.creatorId = effectiveUserId;
    }
    return this.serversService.createServer(dto);
  }

  @Post(':id/channels')
  async addChannel(
    @Param('id') serverId: string,
    @Body() dto: CreateChannelDto,
  ): Promise<Channel> {
    return this.serversService.addChannel(serverId, dto);
  }

  @Delete(':id/channels/:channelId')
  async deleteChannel(
    @Param('id') serverId: string,
    @Param('channelId') channelId: string,
  ): Promise<{ success: boolean; channelId: string }> {
    return this.serversService.deleteChannel(serverId, channelId);
  }

  @Get(':id/invite')
  async generateInvite(
    @Param('id') serverId: string,
  ): Promise<{ code: string; serverId: string; serverName: string }> {
    return this.serversService.generateInviteCode(serverId);
  }

  @Post(':id/invite-friend')
  async inviteFriend(
    @Param('id') serverId: string,
    @Body() body: { friendId: string; inviterId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean }> {
    const inviterId = body.inviterId || userId || headerUserId || 'user';
    return this.serversService.inviteFriendToServer(
      serverId,
      body.friendId,
      inviterId,
    );
  }

  @Post('join/:code')
  async joinByCode(
    @Param('code') code: string,
    @Body() body: { userId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<Server> {
    const effectiveUserId = body.userId || userId || headerUserId || 'user';
    return this.serversService.joinServerByCode(code, effectiveUserId);
  }

  @Patch(':id')
  async updateServer(
    @Param('id') id: string,
    @Body() dto: UpdateServerDto,
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<Server> {
    return this.serversService.updateServer(id, dto);
  }

  @Delete(':id')
  async deleteServer(
    @Param('id') id: string,
    @Body() body: { userId?: string },
    @Query('userId') userId?: string,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<{ success: boolean }> {
    const effectiveUserId = body.userId || userId || headerUserId || 'user';
    return this.serversService.deleteServer(id, effectiveUserId);
  }
}
