import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { SupabaseService } from '../../infra/supabase/supabase.service';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const BUCKET_NAME = 'fizzle-media';

@Controller('upload')
export class UploadController implements OnModuleInit {
  private readonly logger = new Logger(UploadController.name);
  private bucketReady = false;

  constructor(private readonly supabase: SupabaseService) {}

  async onModuleInit() {
    await this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      // Try creating the bucket first — if it already exists Supabase returns an error we can ignore
      const { error: createError } = await this.supabase.admin.storage.createBucket(BUCKET_NAME, {
        public: true,
      });

      if (!createError) {
        // Successfully created a new bucket
        this.bucketReady = true;
        this.logger.log(`Supabase Storage bucket "${BUCKET_NAME}" created and ready ✓`);
        return;
      }

      // If the error is just "already exists", bucket is still usable
      const msg = createError.message?.toLowerCase() ?? '';
      if (msg.includes('already exists') || msg.includes('duplicate') || createError.message === 'Duplicate') {
        this.bucketReady = true;
        this.logger.log(`Supabase Storage bucket "${BUCKET_NAME}" already exists — ready ✓`);
        return;
      }

      // Otherwise, try listing buckets to verify it exists (maybe created externally)
      this.logger.warn(`createBucket returned: ${createError.message} — checking if it already exists...`);
      const { data: buckets, error: listError } = await this.supabase.admin.storage.listBuckets();
      if (listError) {
        this.logger.error(`Cannot connect to Supabase Storage. Check SUPABASE_SERVICE_ROLE_KEY: ${listError.message}`);
        return;
      }

      const exists = buckets?.some((b) => b.name === BUCKET_NAME);
      if (exists) {
        this.bucketReady = true;
        this.logger.log(`Supabase Storage bucket "${BUCKET_NAME}" found — ready ✓`);
      } else {
        this.logger.error(
          `Bucket "${BUCKET_NAME}" does not exist and could not be created: ${createError.message}. ` +
          `Please create it manually at your Supabase dashboard (Storage → New bucket → "${BUCKET_NAME}", set Public).`,
        );
      }
    } catch (err) {
      this.logger.error(`Exception during bucket init: ${err}`);
    }
  }

  private async saveFile(file: Express.Multer.File): Promise<{
    url: string;
    name: string;
    size: number;
    mimeType: string;
  }> {
    // Retry ensuring bucket once if not yet ready
    if (!this.bucketReady) {
      await this.ensureBucket();
    }

    if (!this.bucketReady) {
      throw new InternalServerErrorException(
        `Supabase Storage bucket "${BUCKET_NAME}" chưa sẵn sàng. ` +
        `Vui lòng tạo bucket "${BUCKET_NAME}" (Public) trên Supabase Dashboard và khởi động lại server.`,
      );
    }

    const ext = extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const uniqueName = `${uniqueSuffix}${ext}`;
    const storagePath = `chat/${uniqueName}`;

    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      this.logger.error(`Supabase upload failed [${storagePath}]: ${error.message}`);
      throw new InternalServerErrorException(`Upload thất bại: ${error.message}`);
    }

    const { data: publicData } = this.supabase.admin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    const publicUrl = publicData?.publicUrl;
    if (!publicUrl) {
      throw new InternalServerErrorException('Không lấy được public URL từ Supabase Storage.');
    }

    this.logger.log(`✓ Uploaded to Supabase: ${publicUrl}`);
    return {
      url: publicUrl,
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
