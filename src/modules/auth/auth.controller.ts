import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
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
  ChangePasswordDto,
  ChangeUsernameDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  RequestEmailChangeDto,
  ResendOtpDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailChangeDto,
  VerifyOtpDto,
  VerifyResetCodeDto,
} from './dto/auth.dto';
import {
  changePasswordSchema,
  changeUsernameSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  requestEmailChangeSchema,
  resendOtpSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailChangeSchema,
  verifyOtpSchema,
  verifyResetCodeSchema,
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
  ): Promise<RegisterResultDto> {
    return this.auth.register(dto);
  }

  /** Tight limit in prod, relaxed for dev testing. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resendOtp(
    @Body(new ZodValidationPipe(resendOtpSchema)) dto: ResendOtpDto,
  ): Promise<void> {
    return this.auth.resendOtp(dto.email);
  }

  /** Same budget as resend-otp */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ): Promise<void> {
    return this.auth.forgotPassword(dto.email);
  }

  /**
   * Step 1 of recovery. Returns a ticket rather than a session — the caller
   * has proved they hold the code, not that they know the password.
   */
  @Post('verify-reset-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyResetCode(
    @Body(new ZodValidationPipe(verifyResetCodeSchema)) dto: VerifyResetCodeDto,
  ): Promise<{ resetToken: string; expiresIn: number }> {
    return this.auth.verifyResetCode(dto.email, dto.code);
  }

  /**
   * Step 2 of recovery. Deliberately returns no session: changing the password
   * revokes every existing one, so the user signs in again with the new
   * credentials.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ): Promise<void> {
    return this.auth.resetPassword(dto.resetToken, dto.password);
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

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() user: UserDto,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<{ user: UserDto }> {
    const updatedUser = await this.auth.updateProfile(
      user.id,
      user.email,
      user.emailVerified,
      dto,
    );
    return { user: updatedUser };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: UserDto,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.id, user.email, dto);
  }

  @Post('change-username')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async changeUsername(
    @CurrentUser() user: UserDto,
    @Body(new ZodValidationPipe(changeUsernameSchema)) dto: ChangeUsernameDto,
  ): Promise<{ user: UserDto }> {
    const updatedUser = await this.auth.changeUsername(user.id, user.email, dto);
    return { user: updatedUser };
  }

  @Post('request-email-change')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  async requestEmailChange(
    @CurrentUser() user: UserDto,
    @Body(new ZodValidationPipe(requestEmailChangeSchema)) dto: RequestEmailChangeDto,
  ): Promise<{ message: string }> {
    return this.auth.requestEmailChange(user.id, user.email, dto);
  }

  @Post('verify-email-change')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  async verifyEmailChange(
    @CurrentUser() user: UserDto,
    @Body(new ZodValidationPipe(verifyEmailChangeSchema)) dto: VerifyEmailChangeDto,
  ): Promise<{ user: UserDto }> {
    const updatedUser = await this.auth.verifyEmailChange(
      user.id,
      user.email,
      user.emailVerified,
      dto,
    );
    return { user: updatedUser };
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
