import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express, { json, urlencoded } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(cookieParser());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Serve static assets and uploaded files on backend
  app.use('/public', express.static(join(process.cwd(), 'public')));
  app.use('/assets', express.static(join(process.cwd(), 'public', 'assets')));
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));
  app.use('/fizzle-mark.png', (req, res) => {
    res.sendFile(join(process.cwd(), 'public', 'fizzle-mark.png'));
  });

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
