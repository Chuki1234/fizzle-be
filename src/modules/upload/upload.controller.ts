import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const multerStorage = diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
  },
});

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

@Controller('upload')
export class UploadController {
  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', { storage: multerStorage, limits: { fileSize: MAX_SIZE } }),
  )
  uploadSingle(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file nào được gửi lên.');
    const url = `/uploads/${file.filename}`;
    return {
      url,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  @Post('files')
  @UseInterceptors(
    FilesInterceptor('files', 10, { storage: multerStorage, limits: { fileSize: MAX_SIZE } }),
  )
  uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0)
      throw new BadRequestException('Không có file nào được gửi lên.');
    return files.map((file) => ({
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    }));
  }
}
