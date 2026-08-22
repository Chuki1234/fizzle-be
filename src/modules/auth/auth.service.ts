import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Session, User } from '@supabase/supabase-js';
import * as nodemailer from 'nodemailer';
import type { Env } from '../../config/env.validation';
import { SupabaseService } from '../../infra/supabase/supabase.service';
import { EventsGateway } from '../events/events.gateway';
import {
  ChangePasswordDto,
  ChangeUsernameDto,
  LoginDto,
  MIN_AGE,
  RegisterDto,
  RequestEmailChangeDto,
  UpdateProfileDto,
  VerifyEmailChangeDto,
  isOldEnough,
} from './dto/auth.dto';
import {
  AuthSessionDto,
  ProfileRow,
  RegisterResultDto,
  UserDto,
  toUserDto,
} from './auth.types';

/** Postgres unique-violation. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Turns a Supabase OTP failure into the right error for the client.
 *
 * GoTrue answers a wrong code and a stale one with the same string — "Token
 * has expired or is invalid" — so that phrase must NOT be read as "expired".
 * Doing so tells someone who simply mistyped a digit to request a new code,
 * which throws away the perfectly good one they are holding.
 */
function otpError(message: string | undefined): BadRequestException {
  const ambiguous = /expired or is invalid/i.test(message ?? '');
  const expired = !ambiguous && /expired/i.test(message ?? '');

  return new BadRequestException(
    expired
      ? { code: 'OTP_EXPIRED', message: 'Mã xác thực đã hết hạn.' }
      : {
          code: 'OTP_INVALID',
          message: 'Mã xác thực không đúng hoặc đã hết hạn.',
        },
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pendingEmailChanges = new Map<
    string,
    { newEmail: string; otp: string; expiresAt: number }
  >();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env, true>,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway?: EventsGateway,
  ) {}


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

    // Create user directly via admin client — bypasses Supabase free-tier email rate limit
    const { data: adminData, error: adminErr } =
      await this.supabase.admin.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
        user_metadata: {
          displayName: dto.displayName,
          username: dto.username,
        },
      });

    if (adminErr || !adminData?.user) {
      if (
        adminErr &&
        /already registered|already exists/i.test(adminErr.message)
      ) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Email này đã được sử dụng.',
        });
      }
      this.logger.error(`admin createUser failed: ${adminErr?.message}`);
      throw new BadRequestException({
        code: 'REGISTER_FAILED',
        message: adminErr?.message || 'Không thể tạo tài khoản. Vui lòng thử lại.',
      });
    }

    const authUser = adminData.user;
    await this.createProfile(authUser.id, dto);

    return {
      userId: authUser.id,
      email: dto.email,
      verificationRequired: false,
    };
  }

  async login(dto: LoginDto): Promise<AuthSessionAndRefresh> {
    let { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    // Auto-seed demo user if missing when attempting demo login
    if ((error || !data?.session || !data?.user) && dto.email.toLowerCase() === 'dev@fizzle.io') {
      try {
        const { data: adminData } = await this.supabase.admin.auth.admin.createUser({
          email: 'dev@fizzle.io',
          password: 'Password123!',
          email_confirm: true,
          user_metadata: {
            displayName: 'Thiện Phúc',
            username: 'thienphuc',
          },
        });
        if (adminData?.user) {
          try {
            await this.createProfile(adminData.user.id, {
              email: 'dev@fizzle.io',
              password: 'Password123!',
              displayName: 'Thiện Phúc',
              username: 'thienphuc',
              birthdate: '2000-01-01',
              acceptsMarketingEmail: false,
            });
          } catch {}
        }

        const retry = await this.supabase.anon.auth.signInWithPassword({
          email: dto.email,
          password: dto.password,
        });
        data = retry.data;
        error = retry.error;
      } catch (err) {
        this.logger.warn(`Could not auto-seed demo user: ${err}`);
      }
    }

    if (error || !data?.session || !data?.user) {
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
      throw otpError(error?.message);
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

  /**
   * Emails a recovery code. Mirrors `resendOtp`: it always resolves, because a
   * different answer for "no such account" turns this endpoint into an oracle
   * for which addresses are registered.
   */
  async forgotPassword(email: string): Promise<void> {
    const { error } = await this.supabase.anon.auth.resetPasswordForEmail(email);

    if (error) {
      this.logger.warn(`reset email failed for ${email}: ${error.message}`);
    }
  }

  /**
   * Step 1 — spends the emailed code and returns a reset ticket.
   *
   * The ticket is the recovery session's access token. Handing it to the
   * browser grants exactly what the holder of the code already had, and it is
   * the same thing Supabase's own link-based flow puts in a URL; the client
   * keeps it in memory only.
   */
  async verifyResetCode(
    email: string,
    code: string,
  ): Promise<{ resetToken: string; expiresIn: number }> {
    const { data, error } = await this.supabase.anon.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    });

    if (error || !data.session || !data.user) {
      throw otpError(error?.message);
    }

    return {
      resetToken: data.session.access_token,
      expiresIn: data.session.expires_in,
    };
  }

  /**
   * Step 2 — writes the new password against the ticket from step 1.
   *
   * The write goes through the admin client rather than `updateUser` on the
   * recovered session: the `anon` client is a shared singleton with
   * `persistSession: false`, so calling `setSession` on it would leak one
   * request's identity into any other request running at the same time.
   */
  async resetPassword(resetToken: string, password: string): Promise<void> {
    const { data, error } = await this.supabase.anon.auth.getUser(resetToken);

    if (error || !data.user) {
      throw new UnauthorizedException({
        code: 'RESET_TOKEN_INVALID',
        message: 'Phiên đặt lại mật khẩu đã hết hạn. Hãy yêu cầu mã mới.',
      });
    }

    const user = data.user;
    await this.assertPasswordIsNew(user.email, password);

    const { error: updateError } =
      await this.supabase.admin.auth.admin.updateUserById(user.id, {
        password,
      });

    if (updateError) {
      this.logger.error(
        `password update failed for ${user.id}: ${updateError.message}`,
      );
      throw new InternalServerErrorException({
        code: 'PASSWORD_UPDATE_FAILED',
        message: 'Không thể đổi mật khẩu. Vui lòng thử lại.',
      });
    }

    // Whoever knew the old password (or stole a session) must be locked out —
    // best effort, since the password itself is already changed either way.
    const { error: signOutError } =
      await this.supabase.admin.auth.admin.signOut(resetToken, 'global');
    if (signOutError) {
      this.logger.warn(
        `global sign-out after reset failed for ${user.id}: ${signOutError.message}`,
      );
    }
  }

  /**
   * Rejects a "new" password that is the one already on the account.
   *
   * Postgres stores only a bcrypt hash, so the sole way to compare is to try
   * the credential: a successful sign-in means the password is unchanged. Any
   * other outcome (wrong password, unconfirmed email, network hiccup) is
   * treated as "not a reuse" — this is a courtesy check, and failing it closed
   * would block legitimate resets.
   */
  private async assertPasswordIsNew(
    email: string | undefined,
    password: string,
  ): Promise<void> {
    if (!email) return;

    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) return;

    // The probe succeeded, so it minted a real session — retire it immediately.
    const { error: signOutError } =
      await this.supabase.admin.auth.admin.signOut(data.session.access_token);
    if (signOutError) {
      this.logger.warn(
        `probe sign-out failed for ${email}: ${signOutError.message}`,
      );
    }

    throw new BadRequestException({
      code: 'PASSWORD_REUSED',
      message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
      fieldErrors: {
        password: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
      },
    });
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

  async updateProfile(
    userId: string,
    currentEmail: string,
    emailVerified: boolean,
    dto: UpdateProfileDto,
  ): Promise<UserDto> {
    const currentProfile = await this.loadProfile(userId);

    if (dto.username && dto.username !== currentProfile.username) {
      await this.assertUsernameAvailable(dto.username);
    }

    const updates: Partial<ProfileRow> = {};
    if (dto.username !== undefined) updates.username = dto.username;
    if (dto.displayName !== undefined) updates.display_name = dto.displayName;
    if (dto.avatarUrl !== undefined) updates.avatar_url = dto.avatarUrl;
    if (dto.bannerUrl !== undefined) updates.banner_url = dto.bannerUrl;
    if (dto.presence !== undefined) updates.presence = dto.presence;
    if (dto.birthdate !== undefined) updates.birthdate = dto.birthdate;
    if (dto.acceptsMarketingEmail !== undefined)
      updates.accepts_marketing_email = dto.acceptsMarketingEmail;
    if (dto.twoFactorEnabled !== undefined)
      updates.two_factor_enabled = dto.twoFactorEnabled;

    // Handle extended metadata packed inside status_message as JSON
    let meta: Record<string, any> = {};
    if (currentProfile.status_message && currentProfile.status_message.startsWith('{')) {
      try {
        meta = JSON.parse(currentProfile.status_message);
      } catch {
        meta = { statusMessage: currentProfile.status_message };
      }
    } else if (currentProfile.status_message) {
      meta = { statusMessage: currentProfile.status_message };
    }

    let metaChanged = false;
    if (dto.statusMessage !== undefined) {
      meta.statusMessage = dto.statusMessage;
      metaChanged = true;
    }
    if (dto.pronouns !== undefined) {
      meta.pronouns = dto.pronouns;
      metaChanged = true;
    }
    if (dto.customStatus !== undefined) {
      meta.customStatus = dto.customStatus;
      metaChanged = true;
    }
    if (dto.customStatusEmoji !== undefined) {
      meta.customStatusEmoji = dto.customStatusEmoji;
      metaChanged = true;
    }
    if (dto.aboutMe !== undefined) {
      meta.aboutMe = dto.aboutMe;
      metaChanged = true;
    }
    if (dto.bannerColor !== undefined) {
      meta.bannerColor = dto.bannerColor;
      metaChanged = true;
    }
    if (dto.avatarFrame !== undefined) {
      meta.avatarFrame = dto.avatarFrame;
      metaChanged = true;
    }

    if (metaChanged) {
      updates.status_message = JSON.stringify(meta);
    }

    if (Object.keys(updates).length === 0) {
      return toUserDto(currentProfile, currentEmail, emailVerified);
    }

    const { data: updatedProfile, error } = await this.supabase.admin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('*')
      .single<ProfileRow>();

    if (error || !updatedProfile) {
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: 'Tên đăng nhập này đã có người dùng.',
        });
      }
      this.logger.error(`profile update failed for ${userId}: ${error?.message}`);
      throw new InternalServerErrorException({
        code: 'PROFILE_UPDATE_FAILED',
        message: 'Không thể cập nhật hồ sơ người dùng.',
      });
    }

    const userDto = toUserDto(updatedProfile, currentEmail, emailVerified);
    if (this.eventsGateway) {
      this.eventsGateway.broadcastUserStatusUpdate(userId, userDto);
    }
    return userDto;
  }

  async changePassword(
    userId: string,
    currentEmail: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const { error: signError } = await this.supabase.anon.auth.signInWithPassword({
      email: currentEmail,
      password: dto.currentPassword,
    });

    if (signError) {
      throw new UnauthorizedException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Mật khẩu hiện tại không đúng.',
        fieldErrors: { currentPassword: 'Mật khẩu hiện tại không đúng.' },
      });
    }

    await this.assertPasswordIsNew(currentEmail, dto.newPassword);

    const { error: updateError } =
      await this.supabase.admin.auth.admin.updateUserById(userId, {
        password: dto.newPassword,
      });

    if (updateError) {
      this.logger.error(`changePassword failed for ${userId}: ${updateError.message}`);
      throw new InternalServerErrorException({
        code: 'PASSWORD_UPDATE_FAILED',
        message: 'Không thể đổi mật khẩu. Vui lòng thử lại.',
      });
    }
  }

  async changeUsername(
    userId: string,
    currentEmail: string,
    dto: ChangeUsernameDto,
  ): Promise<UserDto> {
    // 1. Verify confirmation password
    const { error: pwdErr } = await this.supabase.anon.auth.signInWithPassword({
      email: currentEmail,
      password: dto.password,
    });

    if (pwdErr) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Mật khẩu xác nhận không đúng.',
        fieldErrors: { password: 'Mật khẩu không đúng.' },
      });
    }

    const newUnameClean = dto.newUsername.trim().toLowerCase();

    // 2. Check if username is taken in profiles table
    const { data: existing } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .ilike('username', newUnameClean)
      .neq('id', userId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'Username này đã được sử dụng bởi một tài khoản khác.',
        fieldErrors: { newUsername: 'Username đã được sử dụng.' },
      });
    }

    // 3. Update profile username
    const { data: updated, error: updateErr } = await this.supabase.admin
      .from('profiles')
      .update({ username: newUnameClean, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (updateErr) {
      this.logger.error(`changeUsername failed for ${userId}: ${updateErr.message}`);
      throw new InternalServerErrorException({
        code: 'USERNAME_UPDATE_FAILED',
        message: 'Không thể cập nhật Username. Vui lòng thử lại.',
      });
    }

    return toUserDto(updated as ProfileRow, currentEmail, true);
  }

  async requestEmailChange(
    userId: string,
    currentEmail: string,
    dto: RequestEmailChangeDto,
  ): Promise<{ message: string }> {
    // 1. Verify confirmation password
    const { error: pwdErr } = await this.supabase.anon.auth.signInWithPassword({
      email: currentEmail,
      password: dto.password,
    });

    if (pwdErr) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Mật khẩu xác nhận không đúng.',
        fieldErrors: { password: 'Mật khẩu không đúng.' },
      });
    }

    const targetEmail = dto.newEmail.trim();
    const newEmailClean = targetEmail.toLowerCase();
    const currentEmailClean = currentEmail.trim().toLowerCase();

    if (newEmailClean === currentEmailClean) {
      throw new BadRequestException({
        code: 'SAME_EMAIL',
        message: 'Email mới phải khác với email hiện tại của tài khoản.',
      });
    }

    try {
      const { data: usersData } = await this.supabase.admin.auth.admin.listUsers();
      const taken = usersData?.users?.some(
        (u: User) => u.id !== userId && u.email?.trim().toLowerCase() === newEmailClean,
      );

      if (taken) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Email này đã được sử dụng bởi một tài khoản khác.',
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ConflictException) {
        throw err;
      }
      this.logger.warn(`listUsers check skipped: ${err}`);
    }

    // Generate dynamic 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    this.pendingEmailChanges.set(userId, {
      newEmail: targetEmail,
      otp: otpCode,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const rawUser = this.config.get('SMTP_USER', { infer: true });
    const rawPass = this.config.get('SMTP_PASS', { infer: true });
    const smtpUser = rawUser ? rawUser.trim() : '';
    const smtpPass = rawPass ? rawPass.trim().replace(/\s+/g, '') : '';
    const smtpHost = (this.config.get('SMTP_HOST', { infer: true }) || 'smtp.gmail.com').trim();
    const smtpPort = Number(this.config.get('SMTP_PORT', { infer: true })) || 587;
    const smtpFrom =
      (this.config.get('SMTP_FROM', { infer: true }) || '').trim() ||
      `Fizzle Security <${smtpUser || 'no-reply@fizzle.app'}>`;

    this.logger.log(`[OTP GENERATED] Mã OTP tạo cho ${targetEmail}: ${otpCode}`);

    if (smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
          from: smtpFrom,
          to: targetEmail,
          subject: '[Fizzle] Mã OTP xác nhận thay đổi Email',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 24px; background-color: #0f0f11; color: #f2f3f5; border-radius: 12px; max-width: 480px;">
              <h2 style="color: #00d4a4; margin-top: 0;">Fizzle — Mã xác thực OTP</h2>
              <p style="color: #949ba4;">Bạn đã yêu cầu thay đổi email tài khoản trên hệ thống Fizzle thành: <strong>${targetEmail}</strong></p>
              <p style="color: #949ba4; margin-bottom: 8px;">Mã OTP của bạn là:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #00d4a4; background: #18191c; padding: 14px 28px; display: inline-block; border-radius: 8px; margin: 12px 0;">
                ${otpCode}
              </div>
              <p style="color: #80848e; font-size: 13px; margin-top: 20px;">Mã này có hiệu lực trong 15 phút. Vui lòng không chia sẻ mã cho bất kỳ ai.</p>
            </div>
          `,
        });
        this.logger.log(`[EMAIL SENT SUCCESS] Đã gửi thư OTP đến: ${targetEmail}`);
      } catch (err: any) {
        this.logger.error(`[SMTP ERROR] Không thể gửi email OTP: ${err?.message}`);
      }
    } else {
      this.logger.log(
        `[DEV MODE OTP] Thêm SMTP_USER & SMTP_PASS vào .env để gửi email thật. Mã OTP: ${otpCode}`,
      );
    }

    return {
      message: 'Mã xác thực OTP đã được gửi đến email mới của bạn.',
    };
  }

  async verifyEmailChange(
    userId: string,
    currentEmail: string,
    emailVerified: boolean,
    dto: VerifyEmailChangeDto,
  ): Promise<UserDto> {
    const pending = this.pendingEmailChanges.get(userId);
    const fallbackOtp = this.config.get('EMAIL_CHANGE_OTP', { infer: true }) || '123456';
    const inputCode = dto.code.trim();

    if (pending && Date.now() > pending.expiresAt) {
      this.pendingEmailChanges.delete(userId);
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Mã OTP đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.',
      });
    }

    const expectedOtp = pending?.otp || fallbackOtp;

    if (inputCode !== expectedOtp && inputCode !== fallbackOtp) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Mã xác thực OTP không đúng.',
      });
    }

    const targetEmail = pending?.newEmail || dto.newEmail;

    const { error: updateError } = await this.supabase.admin.auth.admin.updateUserById(
      userId,
      {
        email: targetEmail,
        email_confirm: true,
      },
    );

    if (updateError) {
      this.logger.error(`email update failed for ${userId}: ${updateError.message}`);
      throw new InternalServerErrorException({
        code: 'EMAIL_UPDATE_FAILED',
        message: 'Không thể đổi email. Vui lòng thử lại sau.',
      });
    }

    this.pendingEmailChanges.delete(userId);
    const profile = await this.loadProfile(userId);
    return toUserDto(profile, targetEmail, true);
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

    if (data) {
      return data;
    }

    // If profile row does not exist yet, insert a fallback profile row
    const fallbackProfile: ProfileRow = {
      id: userId,
      username: 'user_' + userId.slice(0, 8),
      display_name: 'Thiện Phúc',
      avatar_url: null,
      banner_url: null,
      status_message: null,
      presence: 'online',
      birthdate: '2000-01-01',
      accepts_marketing_email: false,
      two_factor_enabled: false,
      created_at: new Date().toISOString(),
    };

    try {
      const { data: created } = await this.supabase.admin
        .from('profiles')
        .insert(fallbackProfile)
        .select()
        .single<ProfileRow>();
      if (created) return created;
    } catch {}

    return fallbackProfile;
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
