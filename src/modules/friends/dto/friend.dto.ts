export interface FriendUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  presence: 'online' | 'idle' | 'dnd' | 'offline';
  statusText?: string;
  relationshipStatus: 'friend' | 'pending' | 'pending_outgoing' | 'none';
}

export class SendFriendRequestDto {
  targetUsername?: string;
  targetUserId?: string;
  senderId?: string;
}

export interface FriendRelationship {
  id: string;
  userAId: string;
  userBId: string;
  status: 'friend' | 'pending'; // userA sent request to userB
  createdAt: string;
}
