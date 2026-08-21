import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ServersService } from './servers.service';
import { CreateChannelDto, CreateServerDto, Server, Channel } from './dto/server.dto';

@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Get()
  getAllServers(): Server[] {
    return this.serversService.getAllServers();
  }

  @Get(':id')
  getServerById(@Param('id') id: string): Server {
    return this.serversService.getServerById(id);
  }

  @Post()
  createServer(@Body() dto: CreateServerDto): Server {
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
}
