import { z } from 'zod';

/**
 * Mirrors `fizzle-fe/src/app/shared/validators/auth.schema.ts`.
 *
 * The client validates for UX; this is the boundary that actually matters, so
 * the rules are repeated here rather than trusted from the request.
 */

const MIN_AGE = 13;

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
  password: z
    .string()
    .min(8, { error: 'Mật khẩu phải có ít nhất 8 ký tự.' })
    .max(72, { error: 'Mật khẩu không được vượt quá 72 ký tự.' })
    .regex(/[a-z]/, { error: 'Mật khẩu phải có ít nhất 1 chữ thường.' })
    .regex(/[A-Z]/, { error: 'Mật khẩu phải có ít nhất 1 chữ hoa.' })
    .regex(/[0-9]/, { error: 'Mật khẩu phải có ít nhất 1 chữ số.' }),
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
  code: z
    .string()
    .regex(/^[0-9]{6}$/, { error: 'Mã xác thực gồm 6 chữ số.' }),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const resendOtpSchema = z.object({
  email: z.email({ error: 'Email không hợp lệ.' }),
});
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;

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
