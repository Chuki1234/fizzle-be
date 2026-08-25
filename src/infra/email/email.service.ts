import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Env } from '../../config/env.validation';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly defaultFrom: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const port = this.config.get('SMTP_PORT', { infer: true }) ?? 587;
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASS', { infer: true });
    const secure =
      this.config.get('SMTP_SECURE', { infer: true }) ?? port === 465;
    this.defaultFrom =
      this.config.get('SMTP_FROM', { infer: true }) ??
      `"Fizzle App" <${user || 'no-reply@fizzle.app'}>`;

    if (host && user && pass) {
      const isGmail = host.toLowerCase().includes('gmail');
      this.transporter = nodemailer.createTransport({
        ...(isGmail ? { service: 'gmail' } : { host, port, secure }),
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false,
        },
      });

      this.transporter.verify((error) => {
        if (error) {
          this.logger.error(
            `❌ SMTP connection failed: ${error.message}. Please check your SMTP_USER and SMTP_PASS.`,
          );
        } else {
          this.logger.log(
            `✅ SMTP Email service ready (${isGmail ? 'Gmail Service' : `${host}:${port}`}) for ${user}. Emails will be delivered directly to inboxes.`,
          );
        }
      });
    } else {
      this.logger.warn(
        '⚠️ No SMTP credentials configured in .env. Real emails will NOT be delivered. OTP codes will be printed to terminal console below. Set SMTP_USER & SMTP_PASS in .env to send real emails.',
      );
    }
  }

  hasSmtp(): boolean {
    return this.transporter !== null;
  }

  async sendOtpEmail(
    to: string,
    otpCode: string,
    type: 'signup' | 'recovery' = 'signup',
  ): Promise<boolean> {
    const isSignup = type === 'signup';
    const title = isSignup
      ? 'Xác thực tài khoản Fizzle'
      : 'Đặt lại mật khẩu Fizzle';
    const description = isSignup
      ? 'Cảm ơn bạn đã đăng ký tài khoản Fizzle! Sử dụng mã OTP bên dưới để hoàn tất xác thực:'
      : 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Sử dụng mã OTP bên dưới:';

    if (!this.transporter) {
      this.logger.log(
        `\n======================================================\n📧 [DEV OTP EMAIL] To: ${to}\n🔑 OTP Code: ${otpCode}\n🎯 Type: ${type} (${title})\n======================================================\n`,
      );
      return true;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #121214; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #dbdee1;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed; background-color: #121214; padding: 40px 10px;">
          <tr>
            <td align="center">
              <!-- Brand Header -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin-bottom: 24px;">
                <tr>
                  <td align="left" style="padding-left: 4px;">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 14px; height: 26px; background-color: #00D294; border-radius: 7px; margin-right: 10px;"></td>
                        <td style="padding-left: 10px; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Fizzle</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Main Card Container -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; background-color: #1a1a1e; border-radius: 16px; border: 1px solid #28282d; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">
                <tr>
                  <td style="padding: 36px 32px 32px 32px;">
                    <h1 style="margin: 0 0 16px 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">${title}</h1>
                    <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">${description}</p>
                    
                    <!-- High-contrast OTP Box -->
                    <div style="background-color: #111113; border: 1px solid #27272a; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 28px 0;">
                      <span style="font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #ffffff; display: inline-block; padding-left: 12px;">${otpCode}</span>
                    </div>

                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #71717a; line-height: 1.6;">
                      Mã có hiệu lực trong <strong>60 phút</strong> và chỉ dùng được một lần.
                    </p>
                    <p style="margin: 0; font-size: 13px; color: #52525b; line-height: 1.6;">
                      Nếu bạn không yêu cầu mã này, hãy bỏ qua email này. Tài khoản của bạn vẫn được bảo mật an toàn.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin-top: 24px;">
                <tr>
                  <td align="center" style="font-size: 12px; color: #52525b;">
                    Fizzle · Email tự động, vui lòng không trả lời
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    try {
      await this.transporter.sendMail({
        from: this.defaultFrom,
        to,
        subject: `[Fizzle] Mã OTP của bạn là ${otpCode}`,
        html: htmlContent,
      });
      this.logger.log(`Email OTP successfully delivered to ${to}`);
      return true;
    } catch (err: any) {
      this.logger.error(
        `Failed to send email via SMTP to ${to}: ${err?.message}`,
      );
      return false;
    }
  }
}
