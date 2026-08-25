import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Guarantees every error leaves the server in the single shape the Angular
 * `errorInterceptor` parses: `{ code, message, fieldErrors? }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(toBody(exception));
      return;
    }

    // Anything unrecognized is a bug — log it, but never leak internals.
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
    } satisfies ErrorBody);
  }
}

function toBody(exception: HttpException): ErrorBody {
  if (
    exception.getStatus() === HttpStatus.TOO_MANY_REQUESTS ||
    exception.name === 'ThrottlerException' ||
    /throttler|too many requests/i.test(exception.message)
  ) {
    return {
      code: 'TOO_MANY_REQUESTS',
      message:
        'Bạn đã gửi quá nhiều yêu cầu liên tục. Vui lòng thử lại sau 1 phút.',
    };
  }

  const payload = exception.getResponse();

  if (typeof payload === 'string') {
    return { code: 'HTTP_ERROR', message: payload };
  }

  const record = payload as Record<string, unknown>;
  const message = record['message'];

  return {
    code: typeof record['code'] === 'string' ? record['code'] : 'HTTP_ERROR',
    message: Array.isArray(message)
      ? String(message[0])
      : typeof message === 'string'
        ? message
        : exception.message,
    fieldErrors: record['fieldErrors'] as Record<string, string> | undefined,
  };
}
