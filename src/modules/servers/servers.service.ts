import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CreateChannelDto, CreateServerDto, Server, Channel } from './dto/server.dto';

const DEFAULT_SERVERS: Server[] = [
  {
    id: 'hsu-it',
    name: 'HSU - AI & IT',
    icon: 'HSU',
    channels: [
      { id: 'c-general', name: 'thảo-luận-chung', type: 'text' },
      { id: 'c-java', name: 'đồ-án-java', type: 'text' },
      { id: 'c-lounge', name: 'Phòng Chờ 🎙️', type: 'voice' },
    ],
  },
  {
    id: 'gaming-hub',
    name: 'Gaming Community',
    icon: '🎮',
    channels: [
      { id: 'c-lol', name: 'league-of-legends', type: 'text' },
      { id: 'c-voice-1', name: 'Team 1 🔊', type: 'voice' },
    ],
  },
];

@Injectable()
export class ServersService implements OnModuleInit {
  private readonly storagePath = path.resolve(process.cwd(), 'data', 'servers.json');
  private servers: Server[] = [];

  onModuleInit() {
    this.ensureStorage();
    this.loadServers();
  }

  private ensureStorage() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.storagePath)) {
      fs.writeFileSync(this.storagePath, JSON.stringify(DEFAULT_SERVERS, null, 2), 'utf-8');
    }
  }

  private loadServers() {
    try {
      const data = fs.readFileSync(this.storagePath, 'utf-8');
      this.servers = JSON.parse(data);
    } catch {
      this.servers = DEFAULT_SERVERS;
    }
  }

  private saveServers() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.servers, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save servers:', e);
    }
  }

  getAllServers(): Server[] {
    return this.servers;
  }

  getServerById(id: string): Server {
    const server = this.servers.find((s) => s.id === id);
    if (!server) {
      throw new NotFoundException(`Server with ID ${id} not found`);
    }
    return server;
  }

  createServer(dto: CreateServerDto): Server {
    const newServerId = 'server-' + Date.now();
    const defaultTextChannelId = 'c-' + Date.now() + '-1';
    const defaultVoiceChannelId = 'c-' + Date.now() + '-2';

    const newServer: Server = {
      id: newServerId,
      name: dto.name.trim(),
      icon: (dto.icon && dto.icon.trim()) || '🔥',
      channels: [
        { id: defaultTextChannelId, name: 'thảo-luận-chung', type: 'text' },
        { id: defaultVoiceChannelId, name: 'Phòng Chờ 🎙️', type: 'voice' },
      ],
    };

    this.servers.push(newServer);
    this.saveServers();
    return newServer;
  }

  addChannel(serverId: string, dto: CreateChannelDto): Channel {
    const server = this.getServerById(serverId);
    const newChannel: Channel = {
      id: 'c-' + Date.now(),
      name: dto.name.toLowerCase().replace(/\s+/g, '-'),
      type: dto.type,
    };

    server.channels.push(newChannel);
    this.saveServers();
    return newChannel;
  }

  deleteChannel(serverId: string, channelId: string): { success: boolean; channelId: string } {
    const server = this.getServerById(serverId);
    const channelIndex = server.channels.findIndex((c) => c.id === channelId);
    if (channelIndex === -1) {
      throw new NotFoundException(`Channel with ID ${channelId} not found in server ${serverId}`);
    }

    server.channels.splice(channelIndex, 1);
    this.saveServers();
    return { success: true, channelId };
  }
}
