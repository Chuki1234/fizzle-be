import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { CreateChannelDto, CreateServerDto, Server, Channel } from './dto/server.dto';
import { EventsGateway } from '../events/events.gateway';
import { SupabaseService } from '../../infra/supabase/supabase.service';

@Injectable()
export class ServersService {
  private memoryServers: Server[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  async getAllServers(): Promise<Server[]> {
    try {
      const { data: dbServers, error } = await this.supabase.admin
        .from('servers')
        .select('*, channels(*)');

      if (!error && dbServers && dbServers.length > 0) {
        const { data: members } = await this.supabase.admin.from('server_members').select('*');
        const memberMap = new Map<string, string[]>();
        if (members) {
          for (const m of members) {
            if (!memberMap.has(m.server_id)) memberMap.set(m.server_id, []);
            memberMap.get(m.server_id)!.push(m.user_id);
          }
        }

        const mapped: Server[] = dbServers.map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon || '🔥',
          channels: (s.channels || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
          })),
          members: memberMap.get(s.id) || [s.creator_id],
        }));

        this.memoryServers = mapped;
        return mapped;
      }
    } catch (e) {
      console.warn('Supabase getAllServers failed, using memory fallback:', e);
    }

    return this.memoryServers;
  }

  async getServersByUserId(userId: string): Promise<Server[]> {
    const effectiveUserId = userId || 'user';

    try {
      // 1. Query server_members for this user
      const { data: memberRows } = await this.supabase.admin
        .from('server_members')
        .select('server_id')
        .eq('user_id', effectiveUserId);

      const serverIds = (memberRows || []).map((r) => r.server_id);

      // 2. Query servers
      let query = this.supabase.admin.from('servers').select('*, channels(*)');
      if (serverIds.length > 0) {
        query = query.or(`id.in.(${serverIds.join(',')}),creator_id.eq.${effectiveUserId}`);
      } else {
        query = query.eq('creator_id', effectiveUserId);
      }

      const { data: dbServers, error } = await query;
      if (!error && dbServers && dbServers.length > 0) {
        const mapped: Server[] = dbServers.map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon || '🔥',
          channels: (s.channels || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
          })),
          members: [effectiveUserId],
        }));
        return mapped;
      }
    } catch (e) {
      console.warn('Supabase getServersByUserId failed, using memory fallback:', e);
    }

    return this.memoryServers.filter(
      (s) => !s.members || s.members.includes(effectiveUserId) || s.members.includes('user'),
    );
  }

  async getServerById(id: string): Promise<Server> {
    try {
      const { data: s, error } = await this.supabase.admin
        .from('servers')
        .select('*, channels(*)')
        .eq('id', id)
        .single();

      if (!error && s) {
        const { data: members } = await this.supabase.admin
          .from('server_members')
          .select('user_id')
          .eq('server_id', id);

        return {
          id: s.id,
          name: s.name,
          icon: s.icon || '🔥',
          channels: (s.channels || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
          })),
          members: (members || []).map((m) => m.user_id),
        };
      }
    } catch {
      // ignore
    }

    const memoryServer = this.memoryServers.find((s) => s.id === id);
    if (!memoryServer) {
      throw new NotFoundException(`Server with ID ${id} not found`);
    }
    return memoryServer;
  }

  async createServer(dto: CreateServerDto): Promise<Server> {
    const newServerId = 'server-' + Date.now();
    const defaultTextChannelId = 'c-' + Date.now() + '-1';
    const defaultVoiceChannelId = 'c-' + Date.now() + '-2';
    const creatorId = dto.creatorId && dto.creatorId !== 'user' ? dto.creatorId : null;

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

    // 1. Insert into Supabase DB
    try {
      await this.supabase.admin.from('servers').insert({
        id: newServerId,
        name: newServer.name,
        icon: newServer.icon,
        creator_id: creatorId,
      });

      await this.supabase.admin.from('channels').insert([
        { id: defaultTextChannelId, server_id: newServerId, name: 'thảo-luận-chung', type: 'text' },
        { id: defaultVoiceChannelId, server_id: newServerId, name: 'Phòng Chờ 🎙️', type: 'voice' },
      ]);

      if (creatorId) {
        await this.supabase.admin.from('server_members').insert({
          server_id: newServerId,
          user_id: creatorId,
          role: 'owner',
        });
      }
    } catch (e) {
      console.warn('Supabase createServer insert failed:', e);
    }

    this.memoryServers.push(newServer);

    // Broadcast server created
    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'SERVER_CREATED', server: newServer });
    } catch {
      // ignore
    }

    return newServer;
  }

  async addChannel(serverId: string, dto: CreateChannelDto): Promise<Channel> {
    const newChannelId = 'c-' + Date.now();
    const newChannel: Channel = {
      id: newChannelId,
      name: dto.name.toLowerCase().replace(/\s+/g, '-'),
      type: dto.type,
    };

    try {
      await this.supabase.admin.from('channels').insert({
        id: newChannelId,
        server_id: serverId,
        name: newChannel.name,
        type: newChannel.type,
      });
    } catch (e) {
      console.warn('Supabase addChannel insert failed:', e);
    }

    const server = this.memoryServers.find((s) => s.id === serverId);
    if (server) {
      server.channels.push(newChannel);
    }

    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'CHANNEL_ADDED', serverId, channel: newChannel });
    } catch {
      // ignore
    }

    return newChannel;
  }

  async deleteChannel(serverId: string, channelId: string): Promise<{ success: boolean; channelId: string }> {
    try {
      await this.supabase.admin.from('channels').delete().eq('id', channelId);
    } catch (e) {
      console.warn('Supabase deleteChannel failed:', e);
    }

    const server = this.memoryServers.find((s) => s.id === serverId);
    if (server) {
      server.channels = server.channels.filter((c) => c.id !== channelId);
    }

    try {
      this.eventsGateway.broadcastServerUpdate({ type: 'CHANNEL_DELETED', serverId, channelId });
    } catch {
      // ignore
    }

    return { success: true, channelId };
  }

  generateInviteCode(serverId: string): { code: string; serverId: string; serverName: string } {
    const server = this.memoryServers.find((s) => s.id === serverId) || { name: 'Máy chủ Fizzle' };
    const code = Buffer.from(`${serverId}:${Date.now()}`).toString('base64url');
    return {
      code,
      serverId,
      serverName: server.name,
    };
  }

  async joinServerByCode(code: string, userId: string): Promise<Server> {
    try {
      const decoded = Buffer.from(code, 'base64url').toString('utf-8');
      const serverId = decoded.split(':')[0];
      return this.addMemberToServer(serverId, userId || 'user');
    } catch {
      throw new NotFoundException('Mã mời không hợp lệ hoặc đã hết hạn');
    }
  }

  async inviteFriendToServer(serverId: string, friendId: string, inviterId: string): Promise<{ success: boolean }> {
    let server: Server;
    try {
      server = await this.getServerById(serverId);
    } catch {
      server = this.memoryServers.find((s) => s.id === serverId) || {
        id: serverId,
        name: 'Máy chủ Fizzle',
        icon: '🔥',
        channels: [],
        members: [],
      };
    }

    // 1. Insert member into Supabase DB
    try {
      await this.supabase.admin.from('server_members').upsert({
        server_id: serverId,
        user_id: friendId,
        role: 'member',
      });
    } catch (e) {
      console.warn('Supabase inviteFriendToServer member insert failed:', e);
    }

    // 2. Update memory server
    if (!server.members) server.members = [];
    if (!server.members.includes(friendId)) {
      server.members.push(friendId);
    }

    // 3. Broadcast invite to friend's user room
    try {
      this.eventsGateway.sendServerInviteNotification(friendId, {
        type: 'SERVER_INVITE',
        server: server,
        inviterId,
      });
      this.eventsGateway.broadcastServerUpdate({ type: 'MEMBER_ADDED', serverId, userId: friendId, server });
    } catch (e) {
      console.warn('Socket broadcast server invite failed:', e);
    }

    return { success: true };
  }

  private async addMemberToServer(serverId: string, userId: string): Promise<Server> {
    const server = await this.getServerById(serverId);

    try {
      await this.supabase.admin.from('server_members').upsert({
        server_id: serverId,
        user_id: userId,
        role: 'member',
      });
    } catch (e) {
      console.warn('Supabase addMemberToServer failed:', e);
    }

    if (!server.members) server.members = [];
    if (!server.members.includes(userId)) {
      server.members.push(userId);
      try {
        this.eventsGateway.broadcastServerUpdate({ type: 'MEMBER_ADDED', serverId, userId, server });
      } catch {
        // ignore
      }
    }
    return server;
  }
}

