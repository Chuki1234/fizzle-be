import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import { Env } from '../../config/env.validation';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async generateToken(
    roomName: string,
    participantIdentity: string,
    participantName?: string,
    username?: string,
    avatarUrl?: string | null,
  ): Promise<string> {
    const apiKey =
      this.config.get('LIVEKIT_API_KEY', { infer: true }) ||
      process.env.LIVEKIT_API_KEY ||
      'API4Jq9MoGMJUuE';
    const apiSecret =
      this.config.get('LIVEKIT_API_SECRET', { infer: true }) ||
      process.env.LIVEKIT_API_SECRET ||
      'PHNogZ9BFcZyVsm5Tfb70iOvadpbOAef1xAYd7S2WJNB';

    if (!apiKey || !apiSecret) {
      throw new Error('LiveKit API Key or Secret is not configured in .env');
    }

    const metadataObj = {
      userId: participantIdentity,
      displayName: participantName || participantIdentity,
      username: username || participantName || participantIdentity,
      avatarUrl: avatarUrl || null,
    };

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName || participantIdentity,
      metadata: JSON.stringify(metadataObj),
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    this.logger.log(
      `Generated LiveKit token for user: ${participantIdentity} in room: ${roomName}`,
    );
    return token;
  }
}

