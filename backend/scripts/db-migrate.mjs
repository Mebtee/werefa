// Apply the Prisma migration history (including the business_category reference
// data) to BOTH local databases: werefa_dev and werefa_test.
//
// Why this exists (Prompt 67 §11): `db:provision` and `db:reset` create the
// databases and roles but leave them EMPTY (0 tables). A fresh environment that
// followed the documented setup therefore got a werefa_test with no schema, and
// `npm run test:db` failed at setup with a confusing missing-relation error
// instead of a clear instruction. Only werefa_dev was ever migrated, because
// `prisma:dev` was documented for dev alone.
//
// This script closes that gap. It is idempotent (`prisma migrate deploy` applies
// only pending migrations and records them in `_prisma_migrations`), runs as the
// migrator role via prisma-migrate.mjs, and derives the werefa_test URL from
// MIGRATOR_DATABASE_URL so no new environment variable is required.
//
// Usage:
//   npm run db:migrate

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const devUrl = envOr('MIGRATOR_DATABASE_URL', '');
if (!devUrl) {
  process.stderr.write('MIGRATOR_DATABASE_URL is not set; configure backend/.env (see .env.example)\n');
  process.exitCode = 2;
  process.exit();
}

const TEST_DATABASE_NAME = 'werefa_test';

let testUrl;
try {
  const parsed = new URL(devUrl);
  parsed.pathname = `/${TEST_DATABASE_NAME}`;
  testUrl = parsed.toString();
} catch {
  process.stderr.write(`MIGRATOR_DATABASE_URL is not a valid URL: ${devUrl}\n`);
  process.exitCode = 2;
  process.exit();
}

const targets = [
  ['werefa_dev', devUrl],
  [TEST_DATABASE_NAME, testUrl],
];

for (const [name, url] of targets) {
  process.stdout.write(`\n--- migrating ${name} ---\n`);
  const result = spawnSync('node', ['scripts/prisma-migrate.mjs', 'deploy'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: true,
    env: { ...process.env, MIGRATOR_DATABASE_URL: url },
  });
  if (result.error) {
    process.stderr.write(`\nfailed to run prisma migrate deploy for ${name}: ${result.error.message}\n`);
    process.exitCode = 1;
    process.exit();
  }
  if (result.status !== 0) {
    process.stderr.write(`\nprisma migrate deploy failed for ${name}\n`);
    process.exitCode = 1;
    process.exit();
  }
}

process.stdout.write('\nmigrations applied to werefa_dev and werefa_test\n');
