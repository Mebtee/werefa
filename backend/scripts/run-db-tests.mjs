// Cross-platform DB-gated test runner (Windows-safe; inline `VAR=x npm run`
// syntax fails under cmd.exe). Requires backend/.env to define TEST_DATABASE_URL
// and the provisioned werefa_test database (doc 07 §1):
//   npm run db:up && npm run db:provision && npm run test:db

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const url = envOr('TEST_DATABASE_URL', '');
if (!url) {
  process.stderr.write('TEST_DATABASE_URL is not set; configure backend/.env (see .env.example)\n');
  process.exitCode = 2;
  process.exit();
}

// --fileParallelism=false: the DB-gated specs share one werefa_test database;
// running them in parallel workers would race each other's reset/insert loops.
const result = spawnSync('npx vitest run src/database src/domain src/api --fileParallelism=false', {
  shell: true,
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env, RUN_DB_TESTS: 'true', TEST_DATABASE_URL: url },
});
if (result.error) {
  process.stderr.write(`\nfailed to run vitest: ${result.error.message}\n`);
}
process.exitCode = result.status ?? 1;