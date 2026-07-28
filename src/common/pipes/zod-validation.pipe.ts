import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

/**
 * Validates a request body against a Zod schema and returns the parsed value,
 * so handlers receive data that is both typed and coerced.
 *
 * Failures come back as `fieldErrors`, matching the shape the Angular forms
 * expect so they can highlight the offending control.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) return result.data;

    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      // First message per field — the rest are noise to a form.
      fieldErrors[key] ??= issue.message;
    }

    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Dữ liệu gửi lên không hợp lệ.',
      fieldErrors,
    });
  }
}
