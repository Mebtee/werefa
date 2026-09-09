import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Runs `prisma migrate deploy` against the migrator URL.
 *
 * Migrations must run as the `migrator` role (bypasses RLS, owns DDL); the app
 * runtime role `app` must never run migrations. We therefore mount the
 * migrator DSN as DATABASE_URL for the Prisma CLI (the schema reads
 * env("DATABASE_URL")).
 *
 * NOTE: uses `shell: true` so `npx`/`npx.cmd` resolves on Windows (npx is a
 * .cmd shim there and cannot be spawned directly). The schema path is quoted
 * defensively in case the checkout path contains spaces.
 */
const migratorUrl = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
if (!migratorUrl) {
  console.error('DATABASE_MIGRATOR_URL (or DATABASE_URL) is required.');
  process.exit(1);
}

const schema = join(process.cwd(), 'prisma', 'schema.prisma');
const command = `npx prisma migrate deploy --schema "${schema}"`;
const res = spawnSync(command, {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: migratorUrl },
});
process.exit(res.status ?? 1);
