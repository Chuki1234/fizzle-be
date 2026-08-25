import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveKitService } from './livekit.service';
import { Env } from '../../config/env.validation';

export interface GetTokenDto {
  channelId: string;
  userId: string;
  displayName?: string;
}

@Controller('livekit')
export class LiveKitController {
  constructor(
    private readonly livekitService: LiveKitService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('token')
  async getToken(@Body() body: GetTokenDto) {
    const { channelId, userId, displayName } = body;

    if (!channelId || !userId) {
      throw new BadRequestException('channelId và userId là bắt buộc');
    }

    const roomName = `channel-${channelId}`;
    const token = await this.livekitService.generateToken(roomName, userId, displayName);
    const livekitUrl =
      this.config.get('LIVEKIT_URL', { infer: true }) ||
      process.env.LIVEKIT_URL ||
      'wss://fizzle-mgyvvhtb.livekit.cloud';

    return {
      token,
      livekitUrl,
      roomName,
      identity: userId,
      name: displayName,
    };
  }
}
