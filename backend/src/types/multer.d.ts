/**
 * Minimal ambient typing for the parts of `multer` (2.x) this project uses.
 *
 * multer 2.x ships JavaScript only (no bundled .d.ts) and this project avoids a
 * `@types/multer` dev-dependency so the multer TS surface stays exactly what we
 * rely on: the `MulterError` class (raised by busboy on size-limit violations)
 * and the `memoryStorage()` factory used by the proof-upload interceptors.
 */
declare module 'multer' {
  export class MulterError extends Error {
    name: 'MulterError';
    code: string;
    field?: string;
    storageErrors?: unknown[];
    constructor(code: string, field?: string);
  }

  export interface StorageEngine {
    _handleFile(req: unknown, file: unknown, cb: (error: Error | unknown, info?: unknown) => void): void;
    _removeFile(req: unknown, file: unknown, cb: (error: Error | unknown) => void): void;
  }

  export function memoryStorage(): StorageEngine;
}