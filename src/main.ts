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

  // Allow dynamic origin matching for localhost, 127.0.0.1 and LAN IPs (192.168.x.x, 10.x.x.x, 172.x.x.x)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // Allow any localhost, local LAN IP, or configured origin
      callback(null, true);
    },
    credentials: true,
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`Fizzle API đang chạy tại http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
