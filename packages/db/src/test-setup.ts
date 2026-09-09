import { spawn } from 'node:child_process';
import { Client } from 'pg';

/**
 * Prepares a clean, fully-bootstrapped test database for integration tests.
 *
 * Steps:
 *   1. Connect as superuser; drop + recreate the test database.
 *   2. Re-run role bootstrap (roles are cluster-wide; this re-grants connect
 *      and default privileges for the fresh test database).
 *   3. Run prisma migrations against the test database (as migrator).
 *   4. Apply the RLS bootstrap (as superuser / table owner).
 *
 * Requires:
 *   DATABASE_URL_SUPERUSER  superuser DSN (creates the test DB)
 *   DATABASE_URL           runtime DSN (derives app/migrator role passwords)
 *   TEST_DB_NAME           default werefa_test
 */
const SUPERUSER_URL = process.env.DATABASE_URL_SUPERUSER ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'werefa_test';
// When invoked via `npm -w @werefa/db run db:test:setup` the cwd is the db
// package itself; allow an explicit override for direct `tsx` runs.
const DB_PKG = process.env.WEREFA_DB_PKG ?? process.cwd();

function replaceDbName(dsn: string, name: string): string {
  const u = new URL(dsn);
  u.pathname = '/' + name;
  return u.toString();
}

function runScript(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', ...args], {
      cwd: DB_PKG,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main(): Promise<void> {
  if (!APP_URL || !SUPERUSER_URL || !MIGRATOR_URL) {
    throw new Error(
      'DATABASE_URL and DATABASE_URL_SUPERUSER (and DATABASE_MIGRATOR_URL) are required for test setup.',
    );
  }

  const su = new Client({ connectionString: SUPERUSER_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
  await su.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  await su.end();

  const testUrl = replaceDbName(SUPERUSER_URL, TEST_DB_NAME);
  const testMigratorUrl = replaceDbName(MIGRATOR_URL, TEST_DB_NAME);

  console.log(`[test-setup] created ${TEST_DB_NAME}`);

  // Roles bootstrap (cluster-wide; re-grants on test DB)
  await runScript(['db:roles'], {
    DATABASE_URL: testUrl,
    DATABASE_URL_SUPERUSER: testUrl,
  });

  // Migrations as migrator against the test DB
  await runScript(['db:migrate'], {
    DATABASE_URL: testMigratorUrl,
    DATABASE_MIGRATOR_URL: testMigratorUrl,
  });

  // RLS policies as superuser against the test DB
  await runScript(['db:rls'], {
    DATABASE_URL_SUPERUSER: testUrl,
    DATABASE_URL: testUrl,
  });

  console.log(`[test-setup] bootstrap complete: ${testUrl}`);
}

main().catch((err) => {
  console.error('[test-setup] failed:', err);
  process.exit(1);
});
