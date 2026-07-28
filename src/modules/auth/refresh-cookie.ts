import { CookieOptions, Response } from 'express';

export const REFRESH_COOKIE = 'fizzle_rt';

/** Supabase refresh tokens are long-lived; 30 days matches the default. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface CookieContext {
  isProduction: boolean;
  domain?: string;
}

/**
 * `httpOnly` keeps the token away from JavaScript (so XSS cannot exfiltrate
 * it) and `sameSite: 'lax'` blocks it from riding along on cross-site POSTs.
 * The path is scoped so it is only ever sent to the endpoints that need it.
 */
function options({ isProduction, domain }: CookieContext): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/auth',
    domain,
    maxAge: MAX_AGE_MS,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  ctx: CookieContext,
): void {
  res.cookie(REFRESH_COOKIE, token, options(ctx));
}

export function clearRefreshCookie(res: Response, ctx: CookieContext): void {
  res.clearCookie(REFRESH_COOKIE, { ...options(ctx), maxAge: undefined });
}
