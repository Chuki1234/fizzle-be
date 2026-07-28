import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../../modules/auth/auth.service';
import { UserDto } from '../../modules/auth/auth.types';

export interface AuthenticatedRequest extends Request {
  user: UserDto;
}

/**
 * Validates the bearer token with Supabase and attaches the resolved user to
 * the request, so `@CurrentUser()` can hand it to controllers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerFrom(req.headers.authorization);

    if (!token) {
      throw new UnauthorizedException({
        code: 'MISSING_TOKEN',
        message: 'Yêu cầu cần đăng nhập.',
      });
    }

    req.user = await this.auth.getUserFromAccessToken(token);
    return true;
  }
}

function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
