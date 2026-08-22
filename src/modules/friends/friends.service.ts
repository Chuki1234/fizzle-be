import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../infra/supabase/supabase.service';
import { EventsGateway } from '../events/events.gateway';
import { FriendRelationship, FriendUser, SendFriendRequestDto } from './dto/friend.dto';

function parseProfileStatus(profile: { status_message?: string | null; username?: string }) {
  let parsedMeta: Record<string, any> = {};
  let displayStatusMessage: string | null = null;
  let isJsonMeta = false;

  if (profile.status_message && profile.status_message.startsWith('{')) {
    try {
      parsedMeta = JSON.parse(profile.status_message);
      isJsonMeta = true;
      if ('statusMessage' in parsedMeta && typeof parsedMeta.statusMessage === 'string') {
        displayStatusMessage = parsedMeta.statusMessage;
      }
    } catch {
      displayStatusMessage = profile.status_message;
    }
  } else {
    displayStatusMessage = profile.status_message ?? null;
  }

  const rawCustom = parsedMeta.customStatus;
  const customStatusValue =
    typeof rawCustom === 'string' && !rawCustom.startsWith('{')
      ? rawCustom
      : (!isJsonMeta ? displayStatusMessage : null);

  return {
    statusText: displayStatusMessage || '',
    customStatus: customStatusValue,
    customStatusEmoji: parsedMeta.customStatusEmoji ?? null,
  };
}

@Injectable()
export class FriendsService {
  private inMemoryRels: { id: string; user_a_id: string; user_b_id: string; status: string; created_at: string }[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  async searchUsers(query: string, currentUserId?: string): Promise<FriendUser[]> {
    const cleanQuery = (query || '').trim().toLowerCase();
    if (!cleanQuery) return [];

    const results: FriendUser[] = [];
    const seenIds = new Set<string>();

    // 1. Search in Supabase profiles
    try {
      const { data: profiles, error } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
        .limit(30);

      if (!error && profiles) {
        for (const p of profiles) {
          if (currentUserId && p.id === currentUserId) continue;
          seenIds.add(p.id);
          const rel = await this.getRelationshipStatus(currentUserId || 'user', p.id);
          const parsed = parseProfileStatus(p);
          results.push({
            id: p.id,
            username: p.username,
            displayName: p.display_name || p.username,
            avatarUrl: p.avatar_url,
            presence: p.presence || 'offline',
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

    // 2. Search fallback mock users
    const MOCK_USERS: FriendUser[] = [
      { id: 'kevin', username: 'kevin_se', displayName: 'Kevin', avatarUrl: null, presence: 'online', statusText: 'Đang chơi League of Legends 🎮', relationshipStatus: 'friend' },
      { id: 'hoang', username: 'nam_dev', displayName: 'Hoàng Nam', avatarUrl: null, presence: 'dnd', statusText: 'Đang làm Đồ Án Cuối Kỳ Java 💻', relationshipStatus: 'friend' },
      { id: 'minh', username: 'tri_mcfc', displayName: 'Minh Trí', avatarUrl: null, presence: 'online', statusText: 'Đang xem Highlights Manchester City ⚽', relationshipStatus: 'friend' },
      { id: 'bao', username: 'bao_game', displayName: 'Gia Bảo', avatarUrl: null, presence: 'idle', statusText: 'Chờ xíu đi pha cà phê ☕', relationshipStatus: 'friend' },
      { id: 'anh', username: 'anh_tuan', displayName: 'Tuấn Anh', avatarUrl: null, presence: 'offline', statusText: 'Ngoại tuyến', relationshipStatus: 'friend' },
      { id: 'khang', username: 'khang_hsu', displayName: 'Quốc Khang', avatarUrl: null, presence: 'online', statusText: 'Muốn kết bạn với bạn', relationshipStatus: 'pending' },
    ];

    for (const u of MOCK_USERS) {
      if (seenIds.has(u.id)) continue;
      if (currentUserId && u.id === currentUserId) continue;

      if (
        u.username.toLowerCase().includes(cleanQuery) ||
        u.displayName.toLowerCase().includes(cleanQuery)
      ) {
        seenIds.add(u.id);
        const rel = await this.getRelationshipStatus(currentUserId || 'user', u.id);
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
    let dbRels: any[] = [];

    // 1. Fetch relationships from Supabase DB or in-memory
    try {
      const { data, error } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      if (!error && data) {
        dbRels = data;
      }
    } catch {
      // ignore
    }

    // Merge in-memory relationships for this user
    for (const mem of this.inMemoryRels) {
      if (mem.user_a_id === effectiveUserId || mem.user_b_id === effectiveUserId) {
        if (!dbRels.some((r) => r.id === mem.id)) {
          dbRels.push(mem);
        }
      }
    }

    if (dbRels.length === 0) {
      return [];
    }

    // Collect unique partner IDs to fetch profiles
    const partnerIds = new Set<string>();
    for (const rel of dbRels) {
      if (rel.user_a_id === effectiveUserId && rel.user_b_id !== effectiveUserId) {
        partnerIds.add(rel.user_b_id);
      } else if (rel.user_b_id === effectiveUserId && rel.user_a_id !== effectiveUserId) {
        partnerIds.add(rel.user_a_id);
      }
    }

    if (partnerIds.size === 0) {
      return [];
    }

    // 2. Fetch profiles for partners
    const profileMap = new Map<string, any>();
    try {
      const { data: profiles } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .in('id', Array.from(partnerIds));

      if (profiles) {
        for (const p of profiles) {
          profileMap.set(p.id, p);
        }
      }
    } catch {
      // ignore
    }

    // 3. Map relationships to FriendUser models
    for (const rel of dbRels) {
      if (rel.user_a_id === rel.user_b_id) continue;

      if (rel.status === 'friend') {
        const friendId = rel.user_a_id === effectiveUserId ? rel.user_b_id : rel.user_a_id;
        const p = profileMap.get(friendId);
        const parsed = p ? parseProfileStatus(p) : { statusText: '', customStatus: null, customStatusEmoji: null };

        friendsList.push({
          id: friendId,
          username: p?.username || friendId,
          displayName: p?.display_name || p?.username || friendId,
          avatarUrl: p?.avatar_url || null,
          presence: p?.presence || 'offline',
          statusText: parsed.statusText,
          customStatus: parsed.customStatus,
          customStatusEmoji: parsed.customStatusEmoji,
          relationshipStatus: 'friend',
        });
      } else if (rel.status === 'pending') {
        // Incoming request: user_a_id sent to effectiveUserId
        if (rel.user_b_id === effectiveUserId && rel.user_a_id !== effectiveUserId) {
          const senderId = rel.user_a_id;
          const p = profileMap.get(senderId);
          const parsed = p ? parseProfileStatus(p) : { statusText: 'Muốn kết bạn với bạn', customStatus: null, customStatusEmoji: null };

          friendsList.push({
            id: senderId,
            username: p?.username || senderId,
            displayName: p?.display_name || p?.username || senderId,
            avatarUrl: p?.avatar_url || null,
            presence: p?.presence || 'offline',
            statusText: parsed.statusText || 'Muốn kết bạn với bạn',
            customStatus: parsed.customStatus,
            customStatusEmoji: parsed.customStatusEmoji,
            relationshipStatus: 'pending',
          });
        }
        // Outgoing request: effectiveUserId sent to user_b_id
        else if (rel.user_a_id === effectiveUserId && rel.user_b_id !== effectiveUserId) {
          const targetId = rel.user_b_id;
          const p = profileMap.get(targetId);
          const parsed = p ? parseProfileStatus(p) : { statusText: 'Đã gửi lời mời', customStatus: null, customStatusEmoji: null };

          friendsList.push({
            id: targetId,
            username: p?.username || targetId,
            displayName: p?.display_name || p?.username || targetId,
            avatarUrl: p?.avatar_url || null,
            presence: p?.presence || 'offline',
            statusText: parsed.statusText || 'Đã gửi lời mời',
            customStatus: parsed.customStatus,
            customStatusEmoji: parsed.customStatusEmoji,
            relationshipStatus: 'pending_outgoing',
          });
        }
      }
    }

    return friendsList;
  }

  async sendFriendRequest(senderId: string, dto: SendFriendRequestDto): Promise<FriendRelationship> {
    const effectiveSenderId = senderId || dto.senderId || 'user';
    let targetUserId = dto.targetUserId;

    // Find target user by username if targetUserId not provided
    if (!targetUserId && dto.targetUsername) {
      const cleanUsername = dto.targetUsername.trim().toLowerCase();
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

    if (!targetUserId) {
      throw new NotFoundException('Không tìm thấy người dùng với thông tin được cung cấp');
    }

    if (targetUserId === effectiveSenderId) {
      throw new BadRequestException('Bạn không thể gửi lời mời kết bạn cho chính mình');
    }

    // Check existing relationship in DB or in-memory
    let existing: any = null;
    try {
      const { data: existingRels } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveSenderId},user_b_id.eq.${effectiveSenderId}`);

      existing = existingRels?.find(
        (r) =>
          (r.user_a_id === effectiveSenderId && r.user_b_id === targetUserId) ||
          (r.user_a_id === targetUserId && r.user_b_id === effectiveSenderId),
      );
    } catch {
      // ignore
    }

    if (!existing) {
      existing = this.inMemoryRels.find(
        (r) =>
          (r.user_a_id === effectiveSenderId && r.user_b_id === targetUserId) ||
          (r.user_a_id === targetUserId && r.user_b_id === effectiveSenderId),
      );
    }

    if (existing) {
      if (existing.status === 'friend') {
        throw new BadRequestException('Hai bạn đã là bạn bè rồi!');
      }
      if (existing.user_a_id === effectiveSenderId) {
        throw new BadRequestException('Bạn đã gửi lời mời kết bạn cho người này rồi!');
      }
      // Auto-accept if incoming request exists
      existing.status = 'friend';

      try {
        await this.supabase.admin
          .from('friendships')
          .update({ status: 'friend', updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } catch {
        // ignore
      }

      const acceptedRel: FriendRelationship = {
        id: existing.id,
        userAId: existing.user_a_id,
        userBId: existing.user_b_id,
        status: 'friend',
        createdAt: existing.created_at || new Date().toISOString(),
      };
      this.eventsGateway.sendFriendAcceptedNotification(effectiveSenderId, targetUserId, acceptedRel);
      return acceptedRel;
    }

    const newRelId = randomUUID();
    const createdAt = new Date().toISOString();
    const newRel: FriendRelationship = {
      id: newRelId,
      userAId: effectiveSenderId,
      userBId: targetUserId,
      status: 'pending',
      createdAt,
    };

    // Save in-memory
    const memObj = {
      id: newRelId,
      user_a_id: effectiveSenderId,
      user_b_id: targetUserId,
      status: 'pending',
      created_at: createdAt,
    };
    this.inMemoryRels.push(memObj);

    // Try inserting into Supabase DB if table exists
    try {
      await this.supabase.admin.from('friendships').insert({
        id: newRelId,
        user_a_id: effectiveSenderId,
        user_b_id: targetUserId,
        status: 'pending',
        created_at: createdAt,
      });
    } catch (e) {
      console.warn('Supabase insert friendship warning (using in-memory fallback):', e);
    }

    // Get sender's profile for real-time notification
    let senderName = effectiveSenderId;
    let senderUsername = effectiveSenderId;
    let senderAvatarUrl: string | null = null;
    try {
      const { data: senderProf } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .eq('id', effectiveSenderId)
        .single();
      if (senderProf) {
        senderName = senderProf.display_name || senderProf.username || effectiveSenderId;
        senderUsername = senderProf.username || effectiveSenderId;
        senderAvatarUrl = senderProf.avatar_url;
      }
    } catch {
      // ignore
    }

    // Broadcast realtime event
    this.eventsGateway.sendFriendRequestNotification(targetUserId, {
      fromUserId: effectiveSenderId,
      senderDisplayName: senderName,
      senderUsername: senderUsername,
      senderAvatarUrl: senderAvatarUrl,
      relationship: newRel,
    });

    return newRel;
  }

  async acceptFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    // Update in-memory
    const mem = this.inMemoryRels.find(
      (r) =>
        ((r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
          (r.user_a_id === effectiveUserId && r.user_b_id === friendId)) &&
        r.status === 'pending',
    );
    if (mem) {
      mem.status = 'friend';
    } else {
      this.inMemoryRels.push({
        id: randomUUID(),
        user_a_id: effectiveUserId,
        user_b_id: friendId,
        status: 'friend',
        created_at: new Date().toISOString(),
      });
    }

    // Update in Supabase if present
    try {
      const { data: rows } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      const targetRel = rows?.find(
        (r) =>
          ((r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
            (r.user_a_id === effectiveUserId && r.user_b_id === friendId)) &&
          r.status === 'pending',
      );

      if (targetRel) {
        await this.supabase.admin
          .from('friendships')
          .update({ status: 'friend', updated_at: new Date().toISOString() })
          .eq('id', targetRel.id);
      }
    } catch {
      // ignore
    }

    // Broadcast event
    this.eventsGateway.sendFriendAcceptedNotification(effectiveUserId, friendId, {
      userAId: effectiveUserId,
      userBId: friendId,
      status: 'friend',
    });

    return { success: true };
  }

  async rejectFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    this.inMemoryRels = this.inMemoryRels.filter(
      (r) =>
        !(
          ((r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
            (r.user_a_id === effectiveUserId && r.user_b_id === friendId)) &&
          r.status === 'pending'
        ),
    );

    try {
      const { data: rows } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      const targetRel = rows?.find(
        (r) =>
          ((r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
            (r.user_a_id === effectiveUserId && r.user_b_id === friendId)) &&
          r.status === 'pending',
      );

      if (targetRel) {
        await this.supabase.admin.from('friendships').delete().eq('id', targetRel.id);
      }
    } catch {
      // ignore
    }

    return { success: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    this.inMemoryRels = this.inMemoryRels.filter(
      (r) =>
        !(
          (r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
          (r.user_a_id === effectiveUserId && r.user_b_id === friendId)
        ),
    );

    try {
      const { data: rows } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      const targetRel = rows?.find(
        (r) =>
          (r.user_a_id === friendId && r.user_b_id === effectiveUserId) ||
          (r.user_a_id === effectiveUserId && r.user_b_id === friendId),
      );

      if (targetRel) {
        await this.supabase.admin.from('friendships').delete().eq('id', targetRel.id);
      }
    } catch {
      // ignore
    }

    return { success: true };
  }

  private async getRelationshipStatus(
    userId: string,
    targetId: string,
  ): Promise<'friend' | 'pending' | 'pending_outgoing' | 'none'> {
    if (!userId || !targetId || userId === targetId) return 'none';

    // 1. Check in-memory first
    const mem = this.inMemoryRels.find(
      (r) =>
        (r.user_a_id === userId && r.user_b_id === targetId) ||
        (r.user_a_id === targetId && r.user_b_id === userId),
    );
    if (mem) {
      if (mem.status === 'friend') return 'friend';
      if (mem.status === 'pending') {
        return mem.user_a_id === userId ? 'pending_outgoing' : 'pending';
      }
    }

    // 2. Check Supabase DB
    try {
      const { data, error } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

      if (!error && data && data.length > 0) {
        const rel = data.find(
          (r) =>
            (r.user_a_id === userId && r.user_b_id === targetId) ||
            (r.user_a_id === targetId && r.user_b_id === userId),
        );

        if (rel) {
          if (rel.status === 'friend') return 'friend';
          if (rel.status === 'pending') {
            return rel.user_a_id === userId ? 'pending_outgoing' : 'pending';
          }
        }
      }
    } catch {
      // ignore
    }

    return 'none';
  }
}
