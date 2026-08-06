import { z } from 'zod';

/**
 * Mirrors `fizzle-fe/src/app/shared/validators/auth.schema.ts`.
 *
 * The client validates for UX; this is the boundary that actually matters, so
 * the rules are repeated here rather than trusted from the request.
 */

const MIN_AGE = 13;

/**
 * How long an emailed code is, is a Supabase setting (GoTrue allows 6–10;
 * `otp_length` in config.toml, "OTP length" in the dashboard). Validating a
 * fixed 6 here rejects every code a differently-configured project issues, so
 * accept the range and let GoTrue judge the value itself.
 */
const OTP_MIN_LENGTH = 6;
const OTP_MAX_LENGTH = 10;

const otpCodeField = z
  .string()
  .regex(new RegExp(`^[0-9]{${OTP_MIN_LENGTH},${OTP_MAX_LENGTH}}$`), {
    error: `Mã xác thực chỉ gồm chữ số (${OTP_MIN_LENGTH}–${OTP_MAX_LENGTH} ký tự).`,
  });

/** Shared by register and reset — one place defines what a password may be. */
const passwordField = z
  .string()
  .min(8, { error: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  .max(72, { error: 'Mật khẩu không được vượt quá 72 ký tự.' })
  .regex(/[a-z]/, { error: 'Mật khẩu phải có ít nhất 1 chữ thường.' })
  .regex(/[A-Z]/, { error: 'Mật khẩu phải có ít nhất 1 chữ hoa.' })
  .regex(/[0-9]/, { error: 'Mật khẩu phải có ít nhất 1 chữ số.' });

export const registerSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
  displayName: z
    .string()
    .min(1, { error: 'Tên hiển thị không được để trống.' })
    .max(32, { error: 'Tên hiển thị không được vượt quá 32 ký tự.' }),
  username: z
    .string()
    .min(2, { error: 'Tên đăng nhập phải có ít nhất 2 ký tự.' })
    .max(32, { error: 'Tên đăng nhập không được vượt quá 32 ký tự.' })
    .regex(/^[a-z0-9._]+$/, {
      error: 'Chỉ dùng chữ thường, số, dấu chấm và gạch dưới.',
    }),
  password: passwordField,
  birthdate: z.iso.date({ error: 'Ngày sinh không hợp lệ.' }),
  acceptsMarketingEmail: z.boolean().default(false),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
  password: z.string().min(1, { error: 'Vui lòng nhập mật khẩu.' }),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const verifyOtpSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
  code: otpCodeField,
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const resendOtpSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
});
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

/**
 * Step 1 of recovery: prove you hold the emailed code.
 *
 * A recovery code is single-use, so it cannot be replayed when the new
 * password is submitted later. This step therefore trades it for a short-lived
 * reset ticket, and step 2 spends the ticket instead.
 */
export const verifyResetCodeSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
  code: otpCodeField,
});
export type VerifyResetCodeDto = z.infer<typeof verifyResetCodeSchema>;

/** Step 2 of recovery: spend the ticket from step 1 on a new password. */
export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, { error: 'Thiếu vé xác thực.' }),
  password: passwordField,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/** Rejects an under-age birthdate. Kept out of the schema so the message can
 *  name the limit without duplicating the date parsing. */
export function isOldEnough(birthdate: string, today = new Date()): boolean {
  const dob = new Date(`${birthdate}T00:00:00Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age >= MIN_AGE;
}

export { MIN_AGE };
