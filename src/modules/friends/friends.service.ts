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
    statusText: displayStatusMessage || (profile.username ? `@${profile.username}` : ''),
    customStatus: customStatusValue,
    customStatusEmoji: parsedMeta.customStatusEmoji ?? null,
  };
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  async searchUsers(query: string, currentUserId?: string): Promise<FriendUser[]> {
    const cleanQuery = (query || '').trim().toLowerCase();
    if (!cleanQuery) return [];

    const results: FriendUser[] = [];

    try {
      const { data: profiles, error } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
        .limit(20);

      if (!error && profiles) {
        for (const p of profiles) {
          if (currentUserId && p.id === currentUserId) continue;
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

    return results;
  }

  async getUserFriends(userId: string): Promise<FriendUser[]> {
    const effectiveUserId = userId || 'user';
    const friendsList: FriendUser[] = [];

    try {
      // 1. Fetch relationships from Supabase DB
      const { data: dbRels, error: relError } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(`user_a_id.eq.${effectiveUserId},user_b_id.eq.${effectiveUserId}`);

      if (relError || !dbRels || dbRels.length === 0) {
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
      const { data: profiles, error: profError } = await this.supabase.admin
        .from('profiles')
        .select('*')
        .in('id', Array.from(partnerIds));

      const profileMap = new Map<string, any>();
      if (!profError && profiles) {
        for (const p of profiles) {
          profileMap.set(p.id, p);
        }
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
    } catch (e) {
      console.warn('Could not fetch friends from Supabase:', e);
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

    // Check existing relationship in DB
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
        // Auto-accept if incoming request exists
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

    const newRelId = randomUUID();
    const createdAt = new Date().toISOString();
    const newRel: FriendRelationship = {
      id: newRelId,
      userAId: effectiveSenderId,
      userBId: targetUserId,
      status: 'pending',
      createdAt,
    };

    // Insert into Supabase DB
    const { error: insertError } = await this.supabase.admin.from('friendships').insert({
      id: newRelId,
      user_a_id: effectiveSenderId,
      user_b_id: targetUserId,
      status: 'pending',
      created_at: createdAt,
    });

    if (insertError) {
      console.warn('Supabase insert friendship failed:', insertError);
      throw new BadRequestException('Không thể gửi lời mời kết bạn');
    }

    // Broadcast realtime event
    this.eventsGateway.sendFriendRequestNotification(targetUserId, {
      fromUserId: effectiveSenderId,
      relationship: newRel,
    });

    return newRel;
  }

  async acceptFriendRequest(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    const { error } = await this.supabase.admin
      .from('friendships')
      .update({ status: 'friend' })
      .or(
        `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
      );

    if (error) {
      console.warn('Supabase acceptFriendRequest update failed:', error);
      throw new BadRequestException('Không thể chấp nhận lời mời kết bạn');
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

    const { error } = await this.supabase.admin
      .from('friendships')
      .delete()
      .or(
        `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
      );

    if (error) {
      console.warn('Supabase rejectFriendRequest delete failed:', error);
      throw new BadRequestException('Không thể từ chối lời mời kết bạn');
    }

    return { success: true };
  }

  async removeFriend(userId: string, friendId: string): Promise<{ success: boolean }> {
    const effectiveUserId = userId || 'user';

    const { error } = await this.supabase.admin
      .from('friendships')
      .delete()
      .or(
        `and(user_a_id.eq.${friendId},user_b_id.eq.${effectiveUserId}),and(user_a_id.eq.${effectiveUserId},user_b_id.eq.${friendId})`,
      );

    if (error) {
      console.warn('Supabase removeFriend delete failed:', error);
      throw new BadRequestException('Không thể hủy kết bạn');
    }

    return { success: true };
  }

  private async getRelationshipStatus(
    userId: string,
    targetId: string,
  ): Promise<'friend' | 'pending' | 'pending_outgoing' | 'none'> {
    if (!userId || !targetId || userId === targetId) return 'none';

    try {
      const { data, error } = await this.supabase.admin
        .from('friendships')
        .select('*')
        .or(
          `and(user_a_id.eq.${userId},user_b_id.eq.${targetId}),and(user_a_id.eq.${targetId},user_b_id.eq.${userId})`,
        );

      if (error || !data || data.length === 0) return 'none';

      const rel = data[0];
      if (rel.status === 'friend') return 'friend';
      if (rel.status === 'pending') {
        return rel.user_a_id === userId ? 'pending_outgoing' : 'pending';
      }
    } catch {
      // ignore
    }

    return 'none';
  }
}
