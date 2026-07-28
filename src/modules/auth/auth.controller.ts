import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.validation';
import { AuthService } from './auth.service';
import type {
  AuthSessionDto,
  RegisterResultDto,
  UserDto,
} from './auth.types';
import type {
  LoginDto,
  RegisterDto,
  ResendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import {
  loginSchema,
  registerSchema,
  resendOtpSchema,
  verifyOtpSchema,
} from './dto/auth.dto';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
  ): Promise<RegisterResultDto> {
    return this.auth.register(dto);
  }

  /** Tight limit — this endpoint is the brute-force target. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { session, refreshToken } = await this.auth.login(dto);
    setRefreshCookie(res, refreshToken, this.cookieContext());
    return session;
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { session, refreshToken } = await this.auth.verifyOtp(
      dto.email,
      dto.code,
    );
    setRefreshCookie(res, refreshToken, this.cookieContext());
    return session;
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  resendOtp(
    @Body(new ZodValidationPipe(resendOtpSchema)) dto: ResendOtpDto,
  ): Promise<void> {
    return this.auth.resendOtp(dto.email);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];

    if (!token) {
      throw new UnauthorizedException({
        code: 'REFRESH_MISSING',
        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      });
    }

    const { session, refreshToken } = await this.auth.refresh(token);
    // Supabase rotates the refresh token — store the new one.
    setRefreshCookie(res, refreshToken, this.cookieContext());

    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: UserDto): { user: UserDto } {
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    clearRefreshCookie(res, this.cookieContext());
  }

  private cookieContext() {
    return {
      isProduction:
        this.config.get('NODE_ENV', { infer: true }) === 'production',
      domain: this.config.get('COOKIE_DOMAIN', { infer: true }),
    };
  }
}
