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
  bannerGradient: string | null;
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
  phone?: string;
  verificationRequired: boolean;
}

export function toUserDto(
  profile: ProfileRow,
  email: string,
  emailVerified: boolean,
): UserDto {
  let parsedMeta: Record<string, any> = {};
  let displayStatusMessage: string | null = null;
  let isJsonMeta = false;

  if (profile.status_message && profile.status_message.startsWith('{')) {
    try {
      parsedMeta = JSON.parse(profile.status_message);
      isJsonMeta = true;
      if (
        'statusMessage' in parsedMeta &&
        typeof parsedMeta.statusMessage === 'string'
      ) {
        displayStatusMessage = parsedMeta.statusMessage;
      }
    } catch {
      displayStatusMessage = profile.status_message;
    }
  } else {
    displayStatusMessage = profile.status_message;
  }

  const rawCustom = parsedMeta.customStatus;
  const customStatusValue =
    typeof rawCustom === 'string' && !rawCustom.startsWith('{')
      ? rawCustom
      : !isJsonMeta
        ? displayStatusMessage
        : null;

  return {
    id: profile.id,
    email,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bannerUrl: profile.banner_url,
    statusMessage: displayStatusMessage,
    pronouns: parsedMeta.pronouns ?? null,
    customStatus: customStatusValue,
    customStatusEmoji: parsedMeta.customStatusEmoji ?? null,
    aboutMe: parsedMeta.aboutMe ?? null,
    bannerColor: parsedMeta.bannerColor ?? null,
    bannerGradient: parsedMeta.bannerGradient ?? null,
    avatarFrame: parsedMeta.avatarFrame ?? null,
    presence: profile.presence,
    birthdate: profile.birthdate,
    emailVerified,
    twoFactorEnabled: profile.two_factor_enabled,
    acceptsMarketingEmail: profile.accepts_marketing_email,
    createdAt: profile.created_at,
  };
}
