import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../../infra/supabase/supabase.service';
import { EventsGateway } from '../events/events.gateway';
import { FriendRelationship, FriendUser, SendFriendRequestDto } from './dto/friend.dto';

@Injectable()
export class FriendsService {
  private memoryRelationships: FriendRelationship[] = [];

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
        .limit(20);

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

    return results;
  }

  async getUserFriends(userId: string): Promise<FriendUser[]> {
    const effectiveUserId = userId || 'user';
    const friendsList: FriendUser[] = [];
    const userMap = new Map<string, FriendUser>();

    // 1. Fetch all Supabase profiles
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
    } catch (e) {
      console.warn('Could not fetch Supabase profiles:', e);
    }

    // 2. Fetch relationships from Supabase DB
    let relationships: FriendRelationship[] = [];
    try {
      const { data: dbRels, error } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      if (!error && dbRels) {
        relationships = dbRels.map((r) => ({
          id: r.id,
          userAId: r.user_a_id,
          userBId: r.user_b_id,
          status: r.status,
          createdAt: r.created_at,
        }));
      }
    } catch (e) {
      console.warn('Could not fetch friendships from Supabase, using memory fallback:', e);
    }

    // If no relationships in DB, fallback to memory
    if (relationships.length === 0) {
      relationships = this.memoryRelationships.filter(
        (r) => r.userAId === effectiveUserId || r.userBId === effectiveUserId,
      );
    }

    for (const rel of relationships) {
      // Avoid self-friends
      if (rel.userAId === rel.userBId) continue;

      if (rel.status === 'friend') {
        let friendId: string | null = null;
        if (rel.userAId === effectiveUserId) friendId = rel.userBId;
        else if (rel.userBId === effectiveUserId) friendId = rel.userAId;

        if (friendId && friendId !== effectiveUserId) {
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
        if (rel.userBId === effectiveUserId && rel.userAId !== effectiveUserId) {
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
        else if (rel.userAId === effectiveUserId && rel.userBId !== effectiveUserId) {
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

    // Check existing in DB
    try {
      const { data: existingRels } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(
          `and(user_a_id.eq.${effectiveSenderId},user_b_id.eq.${targetUserId}),and(user_a_id.eq.${targetUserId},user_b_id.eq.${effectiveSenderId})`,
        );

      const existing = existingRels?.[0];
      if (existing) {
        if (existing.status === 'friend') {
          throw new BadRequestException('Hai bạn đã là bạn bè rồi!');
        }
        if (existing.user_a_id === effectiveSenderId) {
          throw new BadRequestException('Bạn đã gửi lời mời kết bạn cho người này rồi!');
        }
        // Auto-accept
        await this.supabase.admin.from('friendships').update({ status: 'friend' }).eq('id', existing.id);
        const acceptedRel: FriendRelationship = {
          id: existing.id,
          userAId: existing.user_a_id,
          userBId: existing.user_b_id,
          status: 'friend',
          createdAt: existing.created_at,
        };
        this.eventsGateway.sendFriendAcceptedNotification(effectiveSenderId, targetUserId, acceptedRel);
        return acceptedRel;
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    const newRelId = 'rel-' + Date.now();
    const newRel: FriendRelationship = {
      id: newRelId,
      userAId: effectiveSenderId,
      userBId: targetUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // 1. Insert into Supabase DB
    try {
      await this.supabase.admin.from('friendships').insert({
        id: newRelId,
        user_a_id: effectiveSenderId,
        user_b_id: targetUserId,
        status: 'pending',
        created_at: newRel.createdAt,
      });
    } catch (e) {
      console.warn('Supabase insert friendship failed:', e);
    }

    // 2. Memory cache update
    this.memoryRelationships.push(newRel);

    // 3. Broadcast realtime event
    this.eventsGateway.sendFriendRequestNotification(targetUserId, {
      fromUserId: effectiveSenderId,
      relationship: newRel,
    });

    return newRel;
  }

  async acceptFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    try {
      await this.supabase.admin
        .from('friendships')
        .update({ status: 'friend' })
        .or(
          `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
        );
    } catch (e) {
      console.warn('Supabase acceptFriendRequest update failed:', e);
    }

    // Memory cache update
    const memRel = this.memoryRelationships.find(
      (r) =>
        ((r.userAId === friendId && r.userBId === effectiveUserId) ||
          (r.userAId === effectiveUserId && r.userBId === friendId)) &&
        r.status === 'pending',
    );
    if (memRel) {
      memRel.status = 'friend';
    } else {
      this.memoryRelationships.push({
        id: 'rel-' + Date.now(),
        userAId: effectiveUserId,
        userBId: friendId,
        status: 'friend',
        createdAt: new Date().toISOString(),
      });
    }

    // Broadcast event
    this.eventsGateway.sendFriendAcceptedNotification(effectiveUserId, friendId, {
      userAId: effectiveUserId,
      userBId: friendId,
    });

    return { success: true };
  }

  async rejectFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    try {
      await this.supabase.admin
        .from('friendships')
        .delete()
        .or(
          `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
        );
    } catch (e) {
      console.warn('Supabase rejectFriendRequest delete failed:', e);
    }

    this.memoryRelationships = this.memoryRelationships.filter(
      (r) =>
        !(
          ((r.userAId === friendId && r.userBId === effectiveUserId) ||
            (r.userAId === effectiveUserId && r.userBId === friendId)) &&
          r.status === 'pending'
        ),
    );

    return { success: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    try {
      await this.supabase.admin
        .from('friendships')
        .delete()
        .or(
          `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
        );
    } catch (e) {
      console.warn('Supabase removeFriend delete failed:', e);
    }

    this.memoryRelationships = this.memoryRelationships.filter(
      (r) =>
        !(
          (r.userAId === friendId && r.userBId === effectiveUserId) ||
          (r.userAId === effectiveUserId && r.userBId === friendId)
        ),
    );

    return { success: true };
  }

  private async getRelationshipStatus(
    userId: string,
    targetId: string,
  ): Promise<'friend' | 'pending' | 'pending_outgoing' | 'none'> {
    if (userId === targetId) return 'none';

    try {
      const { data } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(
          `and(user_a_id.eq.${userId},user_b_id.eq.${targetId}),and(user_a_id.eq.${targetId},user_b_id.eq.${userId})`,
        );

      const rel = data?.[0];
      if (!rel) return 'none';
      if (rel.status === 'friend') return 'friend';
      if (rel.status === 'pending') {
        return rel.user_a_id === userId ? 'pending_outgoing' : 'pending';
      }
    } catch {
      // ignore
    }

    const memRel = this.memoryRelationships.find(
      (r) =>
        (r.userAId === userId && r.userBId === targetId) ||
        (r.userAId === targetId && r.userBId === userId),
    );
    if (!memRel) return 'none';
    if (memRel.status === 'friend') return 'friend';
    if (memRel.status === 'pending') {
      return memRel.userAId === userId ? 'pending_outgoing' : 'pending';
    }
    return 'none';
  }
}

/**
 * Parse a Supabase profile row's `status_message` (which may hold a JSON metadata
 * blob) into the display fields the friends search result needs.
 * Mirrors the logic in auth/auth.types.ts `toUserDto`.
 */
function parseProfileStatus(p: any): {
  statusText: string;
  customStatus: string | null;
  customStatusEmoji: string | null;
} {
  const raw: string | null = p?.status_message ?? null;
  let parsedMeta: Record<string, any> = {};
  let displayStatusMessage: string | null = null;
  let isJsonMeta = false;

  if (raw && raw.startsWith('{')) {
    try {
      parsedMeta = JSON.parse(raw);
      isJsonMeta = true;
      if (typeof parsedMeta.statusMessage === 'string') {
        displayStatusMessage = parsedMeta.statusMessage;
      }
    } catch {
      displayStatusMessage = raw;
    }
  } else {
    displayStatusMessage = raw;
  }

  const rawCustom = parsedMeta.customStatus;
  const customStatus =
    typeof rawCustom === 'string' && !rawCustom.startsWith('{')
      ? rawCustom
      : !isJsonMeta
        ? displayStatusMessage
        : null;

  return {
    statusText: displayStatusMessage ?? '',
    customStatus: customStatus ?? null,
    customStatusEmoji: parsedMeta.customStatusEmoji ?? null,
  };
}

