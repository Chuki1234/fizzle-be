import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(cookieParser());

  // `credentials: true` is what lets the browser send the refresh cookie; it
  // requires an explicit origin allow-list, never a wildcard.
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`Fizzle API đang chạy tại http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
