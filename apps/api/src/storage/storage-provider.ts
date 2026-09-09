export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  presignRead(key: string, expiresSeconds: number): Promise<string | null>;
}

export const STORAGE_PROVIDER_TOKEN = Symbol('STORAGE_PROVIDER');
