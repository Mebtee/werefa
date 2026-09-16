// Minimal .env loader (no dotenv dependency). Loads KEY=VALUE lines from the
// backend directory into process.env without overwriting existing variables.
// Values are used only by local dev/provisioning scripts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnvFile(file = join(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function envOr(key, fallback) {
  return process.env[key] ?? fallback;
}