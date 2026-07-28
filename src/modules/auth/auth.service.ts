import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../../infra/supabase/supabase.service';
import { LoginDto, MIN_AGE, RegisterDto, isOldEnough } from './dto/auth.dto';
import {
  AuthSessionDto,
  ProfileRow,
  RegisterResultDto,
  UserDto,
  toUserDto,
} from './auth.types';

/** Postgres unique-violation. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async register(dto: RegisterDto): Promise<RegisterResultDto> {
    if (!isOldEnough(dto.birthdate)) {
      throw new BadRequestException({
        code: 'UNDERAGE',
        message: `Bạn phải từ ${MIN_AGE} tuổi trở lên để tạo tài khoản.`,
        fieldErrors: { birthdate: `Bạn phải từ ${MIN_AGE} tuổi trở lên.` },
      });
    }

    // Check the handle before creating the auth user, so the common conflict
    // does not leave an orphaned account behind.
    await this.assertUsernameAvailable(dto.username);

    const { data, error } = await this.supabase.anon.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Email này đã được sử dụng.',
        });
      }
      this.logger.error(`signUp failed: ${error.message}`);
      throw new BadRequestException({
        code: 'REGISTER_FAILED',
        message: 'Không thể tạo tài khoản. Vui lòng thử lại.',
      });
    }

    const authUser = data.user;
    if (!authUser) {
      throw new InternalServerErrorException({
        code: 'REGISTER_FAILED',
        message: 'Không thể tạo tài khoản. Vui lòng thử lại.',
      });
    }

    await this.createProfile(authUser.id, dto);

    return {
      userId: authUser.id,
      email: dto.email,
      // Supabase withholds the session until the address is confirmed.
      verificationRequired: data.session === null,
    };
  }

  async login(dto: LoginDto): Promise<AuthSessionAndRefresh> {
    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session || !data.user) {
      if (error && /email not confirmed/i.test(error.message)) {
        throw new UnauthorizedException({
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Tài khoản chưa được xác thực. Vui lòng kiểm tra email.',
        });
      }
      // Never distinguish "no such email" from "wrong password".
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    return this.buildSession(data.session, data.user);
  }

  async verifyOtp(email: string, code: string): Promise<AuthSessionAndRefresh> {
    const { data, error } = await this.supabase.anon.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    });

    if (error || !data.session || !data.user) {
      const expired = error && /expired/i.test(error.message);
      throw new BadRequestException({
        code: expired ? 'OTP_EXPIRED' : 'OTP_INVALID',
        message: expired
          ? 'Mã xác thực đã hết hạn.'
          : 'Mã xác thực không đúng.',
      });
    }

    return this.buildSession(data.session, data.user);
  }

  async resendOtp(email: string): Promise<void> {
    const { error } = await this.supabase.anon.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      this.logger.warn(`resend OTP failed for ${email}: ${error.message}`);
    }
    // Always resolve: telling the caller whether the address exists would leak
    // account existence to anyone who can hit this endpoint.
  }

  async refresh(refreshToken: string): Promise<AuthSessionAndRefresh> {
    const { data, error } = await this.supabase.anon.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException({
        code: 'REFRESH_REJECTED',
        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      });
    }

    return this.buildSession(data.session, data.user);
  }

  /** Resolves the caller of an authenticated request from their bearer token. */
  async getUserFromAccessToken(accessToken: string): Promise<UserDto> {
    const { data, error } = await this.supabase.anon.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Phiên đăng nhập không hợp lệ.',
      });
    }

    const profile = await this.loadProfile(data.user.id);
    return toUserDto(profile, data.user.email ?? '', !!data.user.email_confirmed_at);
  }

  /* --- internals -------------------------------------------------------- */

  private async assertUsernameAvailable(username: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      this.logger.error(`username lookup failed: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'INTERNAL_ERROR',
        message: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
      });
    }

    if (data) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'Tên đăng nhập này đã có người dùng.',
      });
    }
  }

  private async createProfile(userId: string, dto: RegisterDto): Promise<void> {
    const { error } = await this.supabase.admin.from('profiles').insert({
      id: userId,
      username: dto.username,
      display_name: dto.displayName,
      birthdate: dto.birthdate,
      accepts_marketing_email: dto.acceptsMarketingEmail,
    });

    if (!error) return;

    // Lost a race on the unique index between the check above and this insert.
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'Tên đăng nhập này đã có người dùng.',
      });
    }

    this.logger.error(`profile insert failed for ${userId}: ${error.message}`);
    throw new InternalServerErrorException({
      code: 'PROFILE_CREATE_FAILED',
      message: 'Không thể tạo hồ sơ người dùng. Vui lòng liên hệ hỗ trợ.',
    });
  }

  private async loadProfile(userId: string): Promise<ProfileRow> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single<ProfileRow>();

    if (error || !data) {
      this.logger.error(`profile missing for ${userId}: ${error?.message}`);
      throw new UnauthorizedException({
        code: 'PROFILE_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ người dùng.',
      });
    }

    return data;
  }

  private async buildSession(
    session: Session,
    user: User,
  ): Promise<AuthSessionAndRefresh> {
    const profile = await this.loadProfile(user.id);

    return {
      session: {
        accessToken: session.access_token,
        expiresIn: session.expires_in,
        user: toUserDto(profile, user.email ?? '', !!user.email_confirmed_at),
      },
      refreshToken: session.refresh_token,
    };
  }
}

/**
 * The refresh token is returned alongside the response body rather than inside
 * it — the controller puts it in an HTTP-only cookie and it never reaches JS.
 */
export interface AuthSessionAndRefresh {
  session: AuthSessionDto;
  refreshToken: string;
}
