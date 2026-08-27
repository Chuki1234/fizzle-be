import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  CreateChannelDto,
  CreateServerDto,
  UpdateServerDto,
  ServerMember,
  UpdateMemberRoleDto,
  Server,
  Channel,
} from './dto/server.dto';
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
        const { data: members } = await this.supabase.admin
          .from('server_members')
          .select('*');
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
          icon: s.icon || (s.name ? s.name.charAt(0).toUpperCase() : 'S'),
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
        query = query.or(
          `id.in.(${serverIds.join(',')}),creator_id.eq.${effectiveUserId}`,
        );
      } else {
        query = query.eq('creator_id', effectiveUserId);
      }

      const { data: dbServers, error } = await query;
      if (!error && dbServers && dbServers.length > 0) {
        const mapped: Server[] = dbServers.map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon || (s.name ? s.name.charAt(0).toUpperCase() : 'S'),
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
      console.warn(
        'Supabase getServersByUserId failed, using memory fallback:',
        e,
      );
    }

    return this.memoryServers.filter(
      (s) =>
        !s.members ||
        s.members.includes(effectiveUserId) ||
        s.members.includes('user'),
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
          icon: s.icon || (s.name ? s.name.charAt(0).toUpperCase() : 'S'),
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
    const creatorId =
      dto.creatorId && dto.creatorId !== 'user' ? dto.creatorId : null;

    const defaultIcon = dto.name.trim().charAt(0).toUpperCase() || 'S';
    const serverIcon = (dto.icon && dto.icon.trim() && dto.icon.trim() !== '🔥') ? dto.icon.trim() : defaultIcon;

    const newServer: Server = {
      id: newServerId,
      name: dto.name.trim(),
      icon: serverIcon,
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
        {
          id: defaultTextChannelId,
          server_id: newServerId,
          name: 'thảo-luận-chung',
          type: 'text',
        },
        {
          id: defaultVoiceChannelId,
          server_id: newServerId,
          name: 'Phòng Chờ 🎙️',
          type: 'voice',
        },
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
      this.eventsGateway.broadcastServerUpdate({
        type: 'SERVER_CREATED',
        server: newServer,
      });
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
      this.eventsGateway.broadcastServerUpdate({
        type: 'CHANNEL_ADDED',
        serverId,
        channel: newChannel,
      });
    } catch {
      // ignore
    }

    return newChannel;
  }

  async deleteChannel(
    serverId: string,
    channelId: string,
  ): Promise<{ success: boolean; channelId: string }> {
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
      this.eventsGateway.broadcastServerUpdate({
        type: 'CHANNEL_DELETED',
        serverId,
        channelId,
      });
    } catch {
      // ignore
    }

    return { success: true, channelId };
  }

  generateInviteCode(serverId: string): {
    code: string;
    serverId: string;
    serverName: string;
  } {
    const server = this.memoryServers.find((s) => s.id === serverId) || {
      name: 'Máy chủ Fizzle',
    };
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

  async inviteFriendToServer(
    serverId: string,
    friendId: string,
    inviterId: string,
  ): Promise<{ success: boolean }> {
    let server: Server;
    try {
      server = await this.getServerById(serverId);
    } catch {
      server = this.memoryServers.find((s) => s.id === serverId) || {
        id: serverId,
        name: 'Máy chủ Fizzle',
        icon: 'F',
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
      this.eventsGateway.broadcastServerUpdate({
        type: 'MEMBER_ADDED',
        serverId,
        userId: friendId,
        server,
      });
    } catch (e) {
      console.warn('Socket broadcast server invite failed:', e);
    }

    return { success: true };
  }

  private async addMemberToServer(
    serverId: string,
    userId: string,
  ): Promise<Server> {
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
        this.eventsGateway.broadcastServerUpdate({
          type: 'MEMBER_ADDED',
          serverId,
          userId,
          server,
        });
      } catch {
        // ignore
      }
    }
    return server;
  }

  async updateServer(id: string, dto: UpdateServerDto): Promise<Server> {
    const server = await this.getServerById(id);

    const updatedFields: Partial<{ name: string; icon: string }> = {};
    if (dto.name && dto.name.trim()) {
      updatedFields.name = dto.name.trim();
      server.name = updatedFields.name;
    }
    if (dto.icon !== undefined) {
      updatedFields.icon = dto.icon;
      server.icon = dto.icon;
    }

    try {
      await this.supabase.admin
        .from('servers')
        .update(updatedFields)
        .eq('id', id);
    } catch (e) {
      console.warn('Supabase updateServer failed:', e);
    }

    // Update in memory
    const memIdx = this.memoryServers.findIndex((s) => s.id === id);
    if (memIdx !== -1) {
      this.memoryServers[memIdx] = { ...this.memoryServers[memIdx], ...updatedFields };
    }

    try {
      this.eventsGateway.broadcastServerUpdate({
        type: 'SERVER_UPDATED',
        serverId: id,
        server,
      });
    } catch {
      // ignore
    }

    return server;
  }

  async deleteServer(
    id: string,
    requestingUserId: string,
  ): Promise<{ success: boolean }> {
    // Verify ownership via Supabase
    try {
      const { data: serverRow } = await this.supabase.admin
        .from('servers')
        .select('creator_id')
        .eq('id', id)
        .single();

      if (serverRow && serverRow.creator_id && serverRow.creator_id !== requestingUserId) {
        throw new Error('Bạn không phải chủ sở hữu máy chủ này.');
      }
    } catch (e: any) {
      if (e?.message?.includes('chủ sở hữu')) throw e;
      // If Supabase lookup fails, continue (graceful degradation)
      console.warn('Supabase ownership check failed:', e);
    }

    // 1. Delete channels
    try {
      await this.supabase.admin.from('channels').delete().eq('server_id', id);
    } catch (e) {
      console.warn('Supabase deleteServer channels failed:', e);
    }

    // 2. Delete server members
    try {
      await this.supabase.admin.from('server_members').delete().eq('server_id', id);
    } catch (e) {
      console.warn('Supabase deleteServer members failed:', e);
    }

    // 3. Delete server
    try {
      await this.supabase.admin.from('servers').delete().eq('id', id);
    } catch (e) {
      console.warn('Supabase deleteServer failed:', e);
    }

    // 4. Remove from memory
    this.memoryServers = this.memoryServers.filter((s) => s.id !== id);

    // 5. Broadcast deletion
    try {
      this.eventsGateway.broadcastServerUpdate({
        type: 'SERVER_DELETED',
        serverId: id,
      });
    } catch {
      // ignore
    }

    return { success: true };
  }

  async getServerMembers(serverId: string): Promise<ServerMember[]> {
    try {
      const { data: serverRow } = await this.supabase.admin
        .from('servers')
        .select('creator_id')
        .eq('id', serverId)
        .single();
      const creatorId = serverRow?.creator_id;

      const { data: memberRows, error } = await this.supabase.admin
        .from('server_members')
        .select('*')
        .eq('server_id', serverId);

      if (!error && memberRows && memberRows.length > 0) {
        const userIds = memberRows.map((r) => r.user_id);
        const roleMap = new Map<string, 'owner' | 'admin' | 'moderator' | 'member'>();
        for (const r of memberRows) {
          let role = r.role || 'member';
          if (r.user_id === creatorId) role = 'owner';
          roleMap.set(r.user_id, role);
        }

        const { data: profiles } = await this.supabase.admin
          .from('profiles')
          .select('*')
          .in('id', userIds);

        const profileMap = new Map<string, any>();
        if (profiles) {
          for (const p of profiles) {
            profileMap.set(p.id, p);
          }
        }

        const result: ServerMember[] = [];
        for (const uid of userIds) {
          const p = profileMap.get(uid);
          const role = roleMap.get(uid) || (uid === creatorId ? 'owner' : 'member');
          result.push({
            userId: uid,
            username: p?.username || uid,
            displayName: p?.display_name || p?.username || uid,
            avatarUrl: p?.avatar_url || null,
            presence: p?.presence || 'offline',
            role: role as any,
            joinedAt: p?.created_at,
          });
        }

        return result;
      }
    } catch (e) {
      console.warn('Supabase getServerMembers failed, using fallback:', e);
    }

    const memoryServer = this.memoryServers.find((s) => s.id === serverId);
    if (!memoryServer) return [];

    const memberIds = memoryServer.members || ['user'];
    return memberIds.map((uid) => ({
      userId: uid,
      username: uid,
      displayName: uid === 'user' ? 'Bạn' : uid,
      avatarUrl: null,
      presence: 'online',
      role: uid === 'user' || uid === memoryServer.creatorId ? 'owner' : 'member',
    }));
  }

  async updateMemberRole(
    serverId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
    requestingUserId?: string,
  ): Promise<{ success: boolean; role: string }> {
    try {
      await this.supabase.admin
        .from('server_members')
        .upsert({
          server_id: serverId,
          user_id: targetUserId,
          role: dto.role,
        });
    } catch (e) {
      console.warn('Supabase updateMemberRole failed:', e);
    }

    try {
      this.eventsGateway.broadcastServerUpdate({
        type: 'SERVER_UPDATED',
        serverId,
      });
    } catch {
      // ignore
    }

    return { success: true, role: dto.role };
  }

  async removeMember(
    serverId: string,
    targetUserId: string,
    requestingUserId?: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.supabase.admin
        .from('server_members')
        .delete()
        .eq('server_id', serverId)
        .eq('user_id', targetUserId);
    } catch (e) {
      console.warn('Supabase removeMember failed:', e);
    }

    const memoryServer = this.memoryServers.find((s) => s.id === serverId);
    if (memoryServer && memoryServer.members) {
      memoryServer.members = memoryServer.members.filter((m) => m !== targetUserId);
    }

    try {
      this.eventsGateway.broadcastServerUpdate({
        type: 'MEMBER_REMOVED',
        serverId,
        userId: targetUserId,
      });
    } catch {
      // ignore
    }

    return { success: true };
  }
}


