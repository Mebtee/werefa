import { Inject, Injectable } from '@nestjs/common';
import { FileCategory, FileObject, Prisma, PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { FileRepository } from './file.repository.port';

@Injectable()
export class PrismaFileRepository implements FileRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(tx: Prisma.TransactionClient, args: {
    businessId: string | null;
    category: FileCategory;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    checksumSha256: string;
  }): Promise<FileObject> {
    return tx.fileObject.create({
      data: {
        businessId: args.businessId,
        category: args.category,
        storageKey: args.storageKey,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        checksumSha256: args.checksumSha256,
      },
    });
  }

  async findById(id: string): Promise<FileObject | null> {
    return this.prisma.fileObject.findUnique({ where: { id } });
  }
}