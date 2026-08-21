/** The profile row as stored in Postgres (snake_case, straight from the DB). */
export interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string | null;
  status_message: string | null;
  presence: 'online' | 'idle' | 'dnd' | 'offline';
  birthdate: string | null;
  accepts_marketing_email: boolean;
  two_factor_enabled: boolean;
  created_at: string;
}

/** The camelCase user object the Angular client consumes. */
export interface UserDto {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  statusMessage: string | null;
  pronouns: string | null;
  customStatus: string | null;
  customStatusEmoji: string | null;
  aboutMe: string | null;
  bannerColor: string | null;
  avatarFrame: string | null;
  presence: 'online' | 'idle' | 'dnd' | 'offline';
  birthdate: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  acceptsMarketingEmail: boolean;
  createdAt: string;
}

export interface AuthSessionDto {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
}

export interface RegisterResultDto {
  userId: string;
  email: string;
  verificationRequired: boolean;
}

export function toUserDto(
  profile: ProfileRow,
  email: string,
  emailVerified: boolean,
): UserDto {
  let parsedMeta: Record<string, any> = {};
  let displayStatusMessage: string | null = profile.status_message;

  if (profile.status_message && profile.status_message.startsWith('{')) {
    try {
      parsedMeta = JSON.parse(profile.status_message);
      if ('statusMessage' in parsedMeta) {
        displayStatusMessage = parsedMeta.statusMessage;
      }
    } catch {
      // Not JSON, treat as plain string
    }
  }

  return {
    id: profile.id,
    email,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bannerUrl: profile.banner_url,
    statusMessage: displayStatusMessage,
    pronouns: parsedMeta.pronouns ?? null,
    customStatus: parsedMeta.customStatus ?? displayStatusMessage,
    customStatusEmoji: parsedMeta.customStatusEmoji ?? null,
    aboutMe: parsedMeta.aboutMe ?? null,
    bannerColor: parsedMeta.bannerColor ?? null,
    avatarFrame: parsedMeta.avatarFrame ?? null,
    presence: profile.presence,
    birthdate: profile.birthdate,
    emailVerified,
    twoFactorEnabled: profile.two_factor_enabled,
    acceptsMarketingEmail: profile.accepts_marketing_email,
    createdAt: profile.created_at,
  };
}

