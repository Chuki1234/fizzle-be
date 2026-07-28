import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { UserDto } from '../../modules/auth/auth.types';

/** Reads the user that `JwtAuthGuard` attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserDto =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
