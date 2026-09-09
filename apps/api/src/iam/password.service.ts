import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing — Argon2id (ADR-001).
 * Wraps the native argon2 binding; tune cost factors for production later.
 */
@Injectable()
export class PasswordService {
  private readonly opts = {
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return hash(plain, this.opts);
  }

  verify(hashValue: string, plain: string): Promise<boolean> {
    return verify(hashValue, plain);
  }
}
