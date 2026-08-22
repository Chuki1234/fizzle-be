import { Injectable, NotFoundException, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CreateChannelDto, CreateServerDto, Server, Channel } from './dto/server.dto';
import { EventsGateway } from '../events/events.gateway';

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
    members: ['user'],
  },
  {
    id: 'gaming-hub',
    name: 'Gaming Community',
    icon: '🎮',
    channels: [
      { id: 'c-lol', name: 'league-of-legends', type: 'text' },
      { id: 'c-voice-1', name: 'Team 1 🔊', type: 'voice' },
    ],
    members: ['user'],
  },
];

@Injectable()
export class ServersService implements OnModuleInit {
  private readonly storagePath = path.resolve(process.cwd(), 'data', 'servers.json');
  private servers: Server[] = [];

  constructor(
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

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
      // Migrate old servers without members field
      for (const s of this.servers) {
        if (!s.members) s.members = ['user'];
      }
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

  getServersByUserId(userId: string): Server[] {
    const effectiveUserId = userId || 'user';
    return this.servers.filter((s) => !s.members || s.members.includes(effectiveUserId));
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
      members: [dto.creatorId || 'user'],
    };

    this.servers.push(newServer);
    this.saveServers();

    // Broadcast server created
    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'SERVER_CREATED', server: newServer });
    } catch (e) { /* ignore */ }

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

    // Broadcast channel added
    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'CHANNEL_ADDED', serverId, channel: newChannel });
    } catch (e) { /* ignore */ }

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

    // Broadcast channel deleted
    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'CHANNEL_DELETED', serverId, channelId });
    } catch (e) { /* ignore */ }

    return { success: true, channelId };
  }

  generateInviteCode(serverId: string): { code: string; serverId: string; serverName: string } {
    const server = this.getServerById(serverId);
    // Simple invite code: base64(serverId + timestamp)
    const code = Buffer.from(`${serverId}:${Date.now()}`).toString('base64url');
    return {
      code,
      serverId,
      serverName: server.name,
    };
  }

  joinServerByCode(code: string, userId: string): Server {
    try {
      const decoded = Buffer.from(code, 'base64url').toString('utf-8');
      const serverId = decoded.split(':')[0];
      return this.addMemberToServer(serverId, userId || 'user');
    } catch {
      throw new NotFoundException('Mã mời không hợp lệ hoặc đã hết hạn');
    }
  }

  inviteFriendToServer(serverId: string, friendId: string, inviterId: string): { success: boolean } {
    const server = this.getServerById(serverId);

    if (!server.members) server.members = [];
    if (!server.members.includes(friendId)) {
      server.members.push(friendId);
      this.saveServers();
    }

    // Broadcast invite to friend's user room
    try {
      this.eventsGateway.sendServerInviteNotification(friendId, {
        type: 'SERVER_INVITE',
        server: server,
        inviterId,
      });
      this.eventsGateway.broadcastServerUpdate({ type: 'MEMBER_ADDED', serverId, userId: friendId, server });
    } catch (e) { /* ignore */ }

    return { success: true };
  }

  private addMemberToServer(serverId: string, userId: string): Server {
    const server = this.getServerById(serverId);
    if (!server.members) server.members = [];
    if (!server.members.includes(userId)) {
      server.members.push(userId);
      this.saveServers();

      try {
        this.eventsGateway.broadcastServerUpdate({ type: 'MEMBER_ADDED', serverId, userId, server });
      } catch (e) { /* ignore */ }
    }
    return server;
  }
}
