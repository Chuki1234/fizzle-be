import { z } from 'zod';

/**
 * Fail fast on boot rather than at the first request: a missing Supabase key
 * should stop the process, not surface as a 500 an hour later.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  SUPABASE_URL: z.url({ error: 'SUPABASE_URL phải là một URL hợp lệ.' }),
  /** Public key — used for password sign-in and refresh on behalf of a user. */
  SUPABASE_ANON_KEY: z.string().min(1),
  /** Server-only key. Bypasses RLS — must never reach the browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:4200'),

  /** Omit in development so the cookie defaults to the request host. */
  COOKIE_DOMAIN: z.string().optional(),

  /** Optional SMTP configuration for direct 100% email delivery */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${details}`);
  }

  return result.data;
}
