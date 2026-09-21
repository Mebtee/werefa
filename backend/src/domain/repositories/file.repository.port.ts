import { FileCategory, FileObject, Prisma } from '@prisma/client';

/**
 * File metadata repository (Prompt 50, REQ-118). FileObject rows are created
 * INSIDE the owning slice transaction alongside the PaymentProof that links to
 * them; the physical bytes are managed separately through PaymentProofStorage.
 */
export interface FileRepository {
  create(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string | null;
      category: FileCategory;
      storageKey: string;
      mimeType: string;
      sizeBytes: bigint;
      checksumSha256: string;
    },
  ): Promise<FileObject>;
  findById(id: string): Promise<FileObject | null>;
}