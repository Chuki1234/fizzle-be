import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { SupabaseService } from '../../infra/supabase/supabase.service';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const BUCKET_NAME = 'fizzle-media';

@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly supabase: SupabaseService) {}

  private async saveFile(file: Express.Multer.File): Promise<{
    url: string;
    name: string;
    size: number;
    mimeType: string;
  }> {
    const ext = extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const uniqueName = `${uniqueSuffix}${ext}`;
    const storagePath = `chat/${uniqueName}`;

    // 1. Try uploading to Supabase Cloud Storage
    try {
      // Ensure bucket exists
      const { data: buckets } = await this.supabase.admin.storage.listBuckets();
      const bucketExists = buckets?.some((b) => b.name === BUCKET_NAME);
      if (!bucketExists) {
        await this.supabase.admin.storage.createBucket(BUCKET_NAME, {
          public: true,
          fileSizeLimit: 100 * 1024 * 1024,
        });
      }

      const { data, error } = await this.supabase.admin.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (!error && data) {
        const { data: publicData } = this.supabase.admin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(storagePath);

        if (publicData?.publicUrl) {
          this.logger.log(`Uploaded file to Supabase Storage: ${publicData.publicUrl}`);
          return {
            url: publicData.publicUrl,
            name: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
          };
        }
      } else if (error) {
        this.logger.warn(`Supabase storage error: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(`Supabase storage upload exception: ${err}`);
    }

    // 2. Fallback: save to local disk
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, uniqueName), file.buffer);

    return {
      url: `/uploads/${uniqueName}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SIZE } }),
  )
  async uploadSingle(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file nào được gửi lên.');
    return this.saveFile(file);
  }

  @Post('files')
  @UseInterceptors(
    FilesInterceptor('files', 10, { storage: memoryStorage(), limits: { fileSize: MAX_SIZE } }),
  )
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0)
      throw new BadRequestException('Không có file nào được gửi lên.');
    return Promise.all(files.map((file) => this.saveFile(file)));
  }
}

