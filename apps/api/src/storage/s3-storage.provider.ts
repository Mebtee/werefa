import { Inject, Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import type { StorageProvider } from './storage-provider';

/**
 * S3-compatible storage via AWS SDK. Works with MinIO (local) and Amazon S3
 * (prod). PROOF objects live in the private bucket; presigned reads are
 * short-lived (5 min, doc 04 §9) and issued only after an actor/tenant check.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucketPrivate: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucketPrivate = config.s3BucketPrivate;
    const s3Config: ConstructorParameters<typeof S3Client>[0] = {
      region: config.s3Region,
      forcePathStyle: config.s3ForcePathStyle,
    };
    if (config.s3Endpoint) s3Config.endpoint = config.s3Endpoint;
    if (config.s3AccessKeyId && config.s3SecretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      };
    }
    this.client = new S3Client(s3Config);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketPrivate,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketPrivate, Key: key }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketPrivate, Key: key }));
  }

  async presignRead(key: string, expiresSeconds: number): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketPrivate, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}
