import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../../config/env.validation';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isAvailable = false;
  private memoryCache = new Map<string, string>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST;
    const redisPort = Number(process.env.REDIS_PORT) || 6379;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    // Chỉ kết nối nếu có cấu hình REDIS_URL hoặc REDIS_HOST rõ ràng
    if (!redisUrl && !redisHost) {
      this.logger.log('Chưa cấu hình REDIS_HOST/REDIS_URL. Hệ thống tự động dùng In-Memory Cache an toàn.');
      return;
    }

    try {
      const options: any = {
        maxRetriesPerRequest: 1,
        retryStrategy: (times: number) => {
          if (times > 2) {
            return null; // Dừng retry nếu không tìm thấy server, tránh spam log
          }
          return 1000;
        },
        lazyConnect: true,
      };

      if (redisUrl) {
        this.client = new Redis(redisUrl, options);
      } else {
        this.client = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          ...options,
        });
      }

      this.client.on('connect', () => {
        this.isAvailable = true;
        this.logger.log('Redis đã kết nối thành công!');
      });

      this.client.on('error', () => {
        if (this.isAvailable) {
          this.isAvailable = false;
        }
      });

      void this.client.connect().catch(() => {
        this.isAvailable = false;
        this.logger.log('Không thể kết nối tới Redis Server. Đang chạy chế độ In-Memory Cache dự phòng.');
      });
    } catch {
      this.isAvailable = false;
      this.logger.log('Khởi tạo Redis thất bại. Đang chạy chế độ In-Memory Cache dự phòng.');
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  getAvailable(): boolean {
    return this.isAvailable;
  }

  async get(key: string): Promise<string | null> {
    if (this.isAvailable && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        return this.memoryCache.get(key) || null;
      }
    }
    return this.memoryCache.get(key) || null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.memoryCache.set(key, value);
    if (this.isAvailable && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
      } catch {}
    }
  }

  async del(key: string): Promise<void> {
    this.memoryCache.delete(key);
    if (this.isAvailable && this.client) {
      try {
        await this.client.del(key);
      } catch {}
    }
  }

  async hset(hash: string, field: string, value: string): Promise<void> {
    this.memoryCache.set(`${hash}:${field}`, value);
    if (this.isAvailable && this.client) {
      try {
        await this.client.hset(hash, field, value);
      } catch {}
    }
  }

  async hget(hash: string, field: string): Promise<string | null> {
    if (this.isAvailable && this.client) {
      try {
        return await this.client.hget(hash, field);
      } catch {
        return this.memoryCache.get(`${hash}:${field}`) || null;
      }
    }
    return this.memoryCache.get(`${hash}:${field}`) || null;
  }

  async hgetall(hash: string): Promise<Record<string, string>> {
    if (this.isAvailable && this.client) {
      try {
        return await this.client.hgetall(hash);
      } catch {}
    }
    const result: Record<string, string> = {};
    const prefix = `${hash}:`;
    for (const [key, val] of this.memoryCache.entries()) {
      if (key.startsWith(prefix)) {
        result[key.substring(prefix.length)] = val;
      }
    }
    return result;
  }

  async hdel(hash: string, field: string): Promise<void> {
    this.memoryCache.delete(`${hash}:${field}`);
    if (this.isAvailable && this.client) {
      try {
        await this.client.hdel(hash, field);
      } catch {}
    }
  }
}
