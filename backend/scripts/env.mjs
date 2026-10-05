// Minimal .env loader (no dotenv dependency). Loads KEY=VALUE lines from the
// backend directory into process.env without overwriting existing variables.
// Values are used only by local dev/provisioning scripts.
//
// Duplicate keys inside one file resolve to the LAST occurrence, matching
// Node's process.loadEnvFile() (used by src/config) and Prisma's own dotenv.
// All three loaders must agree, otherwise a malformed .env makes the
// application and Prisma Migrate connect to different databases.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnvFile(file = join(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  // Resolve the file first, then apply: variables already present in the real
  // process environment still win (injected configuration is never overridden).
  const fromFile = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) {
      fromFile.set(key, value);
    }
  }
  for (const [key, value] of fromFile) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function envOr(key, fallback) {
  return process.env[key] ?? fallback;
}