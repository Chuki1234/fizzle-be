import { Injectable, OnModuleInit, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../../infra/supabase/supabase.service';
import { EventsGateway } from '../events/events.gateway';
import { FriendRelationship, FriendUser, SendFriendRequestDto } from './dto/friend.dto';

const DEFAULT_MOCK_USERS: FriendUser[] = [
  {
    id: 'kevin',
    username: 'kevin_se',
    displayName: 'Kevin',
    avatarUrl: null,
    presence: 'online',
    statusText: 'Đang chơi League of Legends 🎮',
    relationshipStatus: 'friend',
  },
  {
    id: 'hoang',
    username: 'nam_dev',
    displayName: 'Hoàng Nam',
    avatarUrl: null,
    presence: 'dnd',
    statusText: 'Đang làm Đồ Án Cuối Kỳ Java 💻',
    relationshipStatus: 'friend',
  },
  {
    id: 'minh',
    username: 'tri_mcfc',
    displayName: 'Minh Trí',
    avatarUrl: null,
    presence: 'online',
    statusText: 'Đang xem Highlights Manchester City ⚽',
    relationshipStatus: 'friend',
  },
  {
    id: 'bao',
    username: 'bao_game',
    displayName: 'Gia Bảo',
    avatarUrl: null,
    presence: 'idle',
    statusText: 'Chờ xíu đi pha cà phê ☕',
    relationshipStatus: 'friend',
  },
  {
    id: 'anh',
    username: 'anh_tuan',
    displayName: 'Tuấn Anh',
    avatarUrl: null,
    presence: 'offline',
    statusText: 'Ngoại tuyến',
    relationshipStatus: 'friend',
  },
  {
    id: 'khang',
    username: 'khang_hsu',
    displayName: 'Quốc Khang',
    avatarUrl: null,
    presence: 'online',
    statusText: 'Muốn kết bạn với bạn',
    relationshipStatus: 'pending',
  },
];

interface FriendsStorageData {
  relationships: FriendRelationship[];
  customUsers: FriendUser[];
}

@Injectable()
export class FriendsService implements OnModuleInit {
  private readonly storagePath = path.resolve(process.cwd(), 'data', 'friends.json');
  private data: FriendsStorageData = {
    relationships: [
      { id: 'rel-1', userAId: 'user', userBId: 'kevin', status: 'friend', createdAt: new Date().toISOString() },
      { id: 'rel-2', userAId: 'user', userBId: 'hoang', status: 'friend', createdAt: new Date().toISOString() },
      { id: 'rel-3', userAId: 'user', userBId: 'minh', status: 'friend', createdAt: new Date().toISOString() },
      { id: 'rel-4', userAId: 'user', userBId: 'bao', status: 'friend', createdAt: new Date().toISOString() },
      { id: 'rel-5', userAId: 'user', userBId: 'anh', status: 'friend', createdAt: new Date().toISOString() },
      { id: 'rel-6', userAId: 'khang', userBId: 'user', status: 'pending', createdAt: new Date().toISOString() },
    ],
    customUsers: DEFAULT_MOCK_USERS,
  };

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.ensureStorage();
    this.loadData();
  }

  private ensureStorage() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.storagePath)) {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
    }
  }

  private loadData() {
    try {
      const content = fs.readFileSync(this.storagePath, 'utf-8');
      this.data = JSON.parse(content);
      if (!this.data.relationships) this.data.relationships = [];
      if (!this.data.customUsers) this.data.customUsers = DEFAULT_MOCK_USERS;
    } catch {
      // keep defaults
    }
  }

  private saveData() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save friends data:', e);
    }
  }

  async searchUsers(query: string, currentUserId?: string): Promise<FriendUser[]> {
    const cleanQuery = (query || '').trim().toLowerCase();
    if (!cleanQuery) return [];

    const results: FriendUser[] = [];
    const seenIds = new Set<string>();

    // 1. Search in Supabase profiles if configured
    try {
      const { data: profiles, error } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
        .limit(20);

      if (!error && profiles) {
        for (const p of profiles) {
          if (currentUserId && p.id === currentUserId) continue;
          seenIds.add(p.id);
          const rel = this.getRelationshipStatus(currentUserId || 'user', p.id);
          results.push({
            id: p.id,
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url,
            presence: p.presence || 'online',
            statusText: p.status_message || `@${p.username}`,
            relationshipStatus: rel,
          });
        }
      }
    } catch (e) {
      console.warn('Could not query Supabase profiles for search:', e);
    }

    // 2. Search local mock/custom users
    for (const u of this.data.customUsers) {
      if (seenIds.has(u.id)) continue;
      if (currentUserId && u.id === currentUserId) continue;

      if (
        u.username.toLowerCase().includes(cleanQuery) ||
        u.displayName.toLowerCase().includes(cleanQuery)
      ) {
        seenIds.add(u.id);
        const rel = this.getRelationshipStatus(currentUserId || 'user', u.id);
        results.push({
          ...u,
          relationshipStatus: rel,
        });
      }
    }

    return results;
  }

  async getUserFriends(userId: string): Promise<FriendUser[]> {
    const effectiveUserId = userId || 'user';
    const friendsList: FriendUser[] = [];
    const userMap = new Map<string, FriendUser>();

    // Collect all mock/custom users
    for (const u of this.data.customUsers) {
      userMap.set(u.id, u);
    }

    // Also fetch relevant Supabase profiles
    try {
      const { data: profiles } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .limit(100);

      if (profiles) {
        for (const p of profiles) {
          userMap.set(p.id, {
            id: p.id,
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url,
            presence: p.presence || 'online',
            statusText: p.status_message || `@${p.username}`,
            relationshipStatus: 'none',
          });
        }
      }
    } catch {
      // ignore
    }

    for (const rel of this.data.relationships) {
      if (rel.status === 'friend') {
        let friendId: string | null = null;
        if (rel.userAId === effectiveUserId) friendId = rel.userBId;
        else if (rel.userBId === effectiveUserId) friendId = rel.userAId;

        if (friendId) {
          const userObj = userMap.get(friendId) || {
            id: friendId,
            username: friendId,
            displayName: friendId,
            avatarUrl: null,
            presence: 'online',
            statusText: '',
            relationshipStatus: 'friend',
          };
          friendsList.push({
            ...userObj,
            relationshipStatus: 'friend',
          });
        }
      } else if (rel.status === 'pending') {
        // Incoming request: userA sent to effectiveUserId
        if (rel.userBId === effectiveUserId) {
          const userObj = userMap.get(rel.userAId) || {
            id: rel.userAId,
            username: rel.userAId,
            displayName: rel.userAId,
            avatarUrl: null,
            presence: 'online',
            statusText: 'Muốn kết bạn với bạn',
            relationshipStatus: 'pending',
          };
          friendsList.push({
            ...userObj,
            relationshipStatus: 'pending',
          });
        }
        // Outgoing request: effectiveUserId sent to userB
        else if (rel.userAId === effectiveUserId) {
          const userObj = userMap.get(rel.userBId) || {
            id: rel.userBId,
            username: rel.userBId,
            displayName: rel.userBId,
            avatarUrl: null,
            presence: 'online',
            statusText: 'Đã gửi lời mời',
            relationshipStatus: 'pending_outgoing',
          };
          friendsList.push({
            ...userObj,
            relationshipStatus: 'pending_outgoing',
          });
        }
      }
    }

    // Default fallback if friendsList is empty for 'user'
    if (friendsList.length === 0 && effectiveUserId === 'user') {
      return DEFAULT_MOCK_USERS;
    }

    return friendsList;
  }

  async sendFriendRequest(senderId: string, dto: SendFriendRequestDto): Promise<FriendRelationship> {
    const effectiveSenderId = senderId || dto.senderId || 'user';
    let targetUserId = dto.targetUserId;

    // Find target user by username if targetUserId not provided
    if (!targetUserId && dto.targetUsername) {
      const cleanUsername = dto.targetUsername.trim().toLowerCase();
      // Check in custom users
      const customUser = this.data.customUsers.find(
        (u) => u.username.toLowerCase() === cleanUsername,
      );
      if (customUser) {
        targetUserId = customUser.id;
      } else {
        // Check Supabase
        try {
          const { data } = await this.supabase.admin
            .from('profiles')
            .select('id')
            .ilike('username', cleanUsername)
            .single();
          if (data?.id) targetUserId = data.id;
        } catch {
          // not found
        }
      }
    }

    if (!targetUserId) {
      throw new NotFoundException('Không tìm thấy người dùng với thông tin được cung cấp');
    }

    if (targetUserId === effectiveSenderId) {
      throw new BadRequestException('Bạn không thể gửi lời mời kết bạn cho chính mình');
    }

    // Check if relationship already exists
    const existing = this.data.relationships.find(
      (r) =>
        (r.userAId === effectiveSenderId && r.userBId === targetUserId) ||
        (r.userAId === targetUserId && r.userBId === effectiveSenderId),
    );

    if (existing) {
      if (existing.status === 'friend') {
        throw new BadRequestException('Hai bạn đã là bạn bè rồi!');
      }
      if (existing.userAId === effectiveSenderId) {
        throw new BadRequestException('Bạn đã gửi lời mời kết bạn cho người này rồi!');
      }
      // If the other user already sent a pending request, auto accept it!
      existing.status = 'friend';
      this.saveData();
      this.eventsGateway.sendFriendAcceptedNotification(effectiveSenderId, targetUserId, existing);
      return existing;
    }

    const newRel: FriendRelationship = {
      id: 'rel-' + Date.now(),
      userAId: effectiveSenderId,
      userBId: targetUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.data.relationships.push(newRel);
    this.saveData();

    // Broadcast realtime event
    this.eventsGateway.sendFriendRequestNotification(targetUserId, {
      fromUserId: effectiveSenderId,
      relationship: newRel,
    });

    return newRel;
  }

  async acceptFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';
    const rel = this.data.relationships.find(
      (r) =>
        ((r.userAId === friendId && r.userBId === effectiveUserId) ||
          (r.userAId === effectiveUserId && r.userBId === friendId)) &&
        r.status === 'pending',
    );

    if (rel) {
      rel.status = 'friend';
    } else {
      // Create friend relationship if not present
      this.data.relationships.push({
        id: 'rel-' + Date.now(),
        userAId: effectiveUserId,
        userBId: friendId,
        status: 'friend',
        createdAt: new Date().toISOString(),
      });
    }

    this.saveData();

    // Broadcast event
    this.eventsGateway.sendFriendAcceptedNotification(effectiveUserId, friendId, {
      userAId: effectiveUserId,
      userBId: friendId,
    });

    return { success: true };
  }

  async rejectFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';
    const initialLen = this.data.relationships.length;
    this.data.relationships = this.data.relationships.filter(
      (r) =>
        !(
          ((r.userAId === friendId && r.userBId === effectiveUserId) ||
            (r.userAId === effectiveUserId && r.userBId === friendId)) &&
          r.status === 'pending'
        ),
    );

    if (this.data.relationships.length !== initialLen) {
      this.saveData();
    }
    return { success: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';
    this.data.relationships = this.data.relationships.filter(
      (r) =>
        !(
          (r.userAId === friendId && r.userBId === effectiveUserId) ||
          (r.userAId === effectiveUserId && r.userBId === friendId)
        ),
    );
    this.saveData();
    return { success: true };
  }

  private getRelationshipStatus(
    userId: string,
    targetId: string,
  ): 'friend' | 'pending' | 'pending_outgoing' | 'none' {
    const rel = this.data.relationships.find(
      (r) =>
        (r.userAId === userId && r.userBId === targetId) ||
        (r.userAId === targetId && r.userBId === userId),
    );
    if (!rel) return 'none';
    if (rel.status === 'friend') return 'friend';
    if (rel.status === 'pending') {
      return rel.userAId === userId ? 'pending_outgoing' : 'pending';
    }
    return 'none';
  }
}
