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

function parseProfileStatus(p: { username: string; status_message?: string | null }): {
  statusText: string;
  customStatus: string | null;
  customStatusEmoji: string | null;
} {
  if (!p.status_message) {
    return { statusText: '', customStatus: null, customStatusEmoji: null };
  }
  const raw = p.status_message.trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const custom = (typeof parsed.customStatus === 'string' && !parsed.customStatus.trim().startsWith('{')) ? parsed.customStatus.trim() : null;
      const statusMsg = (typeof parsed.statusMessage === 'string' && !parsed.statusMessage.trim().startsWith('{')) ? parsed.statusMessage.trim() : null;
      const emoji = (typeof parsed.customStatusEmoji === 'string' && !parsed.customStatusEmoji.trim().startsWith('{')) ? parsed.customStatusEmoji.trim() : null;

      const cleanText = custom || statusMsg || null;
      if (cleanText || emoji) {
        const text = emoji && cleanText ? `${emoji} ${cleanText}` : (cleanText || emoji || '');
        return { statusText: text, customStatus: cleanText, customStatusEmoji: emoji };
      }
    } catch {
      // ignore
    }
    return { statusText: '', customStatus: null, customStatusEmoji: null };
  }
  if (raw === `@${p.username}` || raw === p.username) {
    return { statusText: '', customStatus: null, customStatusEmoji: null };
  }
  return { statusText: raw, customStatus: raw, customStatusEmoji: null };
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
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
  }

  private loadData() {
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
  }

  private saveData() {
    // Local JSON disk storage disabled - data managed via Supabase / in-memory
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
          const parsed = parseProfileStatus(p);
          results.push({
            id: p.id,
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url,
            presence: p.presence || 'online',
            statusText: parsed.statusText,
            customStatus: parsed.customStatus,
            customStatusEmoji: parsed.customStatusEmoji,
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

    // 1. Fetch relevant Supabase profiles
    try {
      const { data: profiles } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .limit(200);

      if (profiles) {
        for (const p of profiles) {
          const parsed = parseProfileStatus(p);
          userMap.set(p.id, {
            id: p.id,
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url,
            presence: p.presence || 'online',
            statusText: parsed.statusText,
            customStatus: parsed.customStatus,
            customStatusEmoji: parsed.customStatusEmoji,
            relationshipStatus: 'none',
          });
        }
      }
    } catch {
      // ignore
    }

    // Collect all mock/custom users
    for (const u of this.data.customUsers) {
      if (!userMap.has(u.id)) {
        userMap.set(u.id, u);
      }
    }

    // 2. Fetch friend relationships from Supabase DB tables if present
    try {
      // Try fetching from `friendships` table
      const { data: dbFriendships } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_id.eq.${effectiveUserId},friend_id.eq.${effectiveUserId},user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      if (dbFriendships && dbFriendships.length > 0) {
        for (const f of dbFriendships) {
          const uA = f.user_id || f.user_a_id;
          const uB = f.friend_id || f.user_b_id;
          const st = f.status || 'pending';
          const relId = f.id || `rel-${uA}-${uB}`;

          if (!this.data.relationships.some((r) => r.id === relId || (r.userAId === uA && r.userBId === uB))) {
            this.data.relationships.push({
              id: relId,
              userAId: uA,
              userBId: uB,
              status: st === 'accepted' ? 'friend' : (st as any),
              createdAt: f.created_at || new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      // ignore table query failure
    }

    const seenFriendIds = new Set<string>();

    for (const rel of this.data.relationships) {
      if (rel.status === 'friend') {
        let friendId: string | null = null;
        if (rel.userAId === effectiveUserId) friendId = rel.userBId;
        else if (rel.userBId === effectiveUserId) friendId = rel.userAId;

        if (friendId && !seenFriendIds.has(friendId)) {
          seenFriendIds.add(friendId);
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
        if (rel.userBId === effectiveUserId && !seenFriendIds.has(rel.userAId)) {
          seenFriendIds.add(rel.userAId);
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
        else if (rel.userAId === effectiveUserId && !seenFriendIds.has(rel.userBId)) {
          seenFriendIds.add(rel.userBId);
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
      // Check in Supabase profiles
      try {
        const { data } = await this.supabase.admin
          .from('profiles')
          .select('id')
          .ilike('username', cleanUsername)
          .single();
        if (data?.id) targetUserId = data.id;
      } catch {
        // not found in supabase profiles
      }

      if (!targetUserId) {
        const customUser = this.data.customUsers.find(
          (u) => u.username.toLowerCase() === cleanUsername,
        );
        if (customUser) targetUserId = customUser.id;
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

      // Persist status change to Supabase
      void (async () => {
        try {
          await this.supabase.admin
            .from('friendships')
            .update({ status: 'friend' })
            .or(`and(user_id.eq.${effectiveSenderId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${effectiveSenderId})`);
        } catch { /* ignore */ }
      })();

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

    // Persist to Supabase
    void (async () => {
      try {
        await this.supabase.admin
          .from('friendships')
          .insert({
            user_id: effectiveSenderId,
            friend_id: targetUserId,
            status: 'pending',
            created_at: newRel.createdAt,
          });
      } catch {
        try {
          await this.supabase.admin
            .from('user_relationships')
            .insert({
              user_a_id: effectiveSenderId,
              user_b_id: targetUserId,
              status: 'pending',
            });
        } catch {
          // ignore
        }
      }
    })();

    // Broadcast realtime event
    this.eventsGateway.sendFriendRequestNotification(targetUserId, {
      fromUserId: effectiveSenderId,
      targetUserId,
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
      this.data.relationships.push({
        id: 'rel-' + Date.now(),
        userAId: effectiveUserId,
        userBId: friendId,
        status: 'friend',
        createdAt: new Date().toISOString(),
      });
    }

    // Persist to Supabase
    void (async () => {
      try {
        await this.supabase.admin
          .from('friendships')
          .update({ status: 'friend' })
          .or(`and(user_id.eq.${effectiveUserId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${effectiveUserId})`);
      } catch {
        try {
          await this.supabase.admin
            .from('user_relationships')
            .update({ status: 'friend' })
            .or(`and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId}),and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId})`);
        } catch {
          // ignore
        }
      }
    })();

    // Broadcast event
    this.eventsGateway.sendFriendAcceptedNotification(effectiveUserId, friendId, {
      userAId: effectiveUserId,
      userBId: friendId,
    });

    return { success: true };
  }

  async rejectFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';
    this.data.relationships = this.data.relationships.filter(
      (r) =>
        !(
          ((r.userAId === friendId && r.userBId === effectiveUserId) ||
            (r.userAId === effectiveUserId && r.userBId === friendId)) &&
          r.status === 'pending'
        ),
    );

    // Delete from Supabase
    void (async () => {
      try {
        await this.supabase.admin
          .from('friendships')
          .delete()
          .or(`and(user_id.eq.${effectiveUserId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${effectiveUserId})`);
      } catch {
        try {
          await this.supabase.admin
            .from('user_relationships')
            .delete()
            .or(`and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId}),and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId})`);
        } catch {
          // ignore
        }
      }
    })();

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

    // Delete from Supabase
    void (async () => {
      try {
        await this.supabase.admin
          .from('friendships')
          .delete()
          .or(`and(user_id.eq.${effectiveUserId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${effectiveUserId})`);
      } catch {
        try {
          await this.supabase.admin
            .from('user_relationships')
            .delete()
            .or(`and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId}),and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId})`);
        } catch {
          // ignore
        }
      }
    })();

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
