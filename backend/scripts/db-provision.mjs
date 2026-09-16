// Provision the local dev/test databases + the architecture's app/migrator
// roles (doc 07 §1). Idempotent; safe to re-run. Requires Docker.
//
// Roles and databases are created inside the postgres:16 container as its
// superuser; the runtime 'app' role is non-privileged (RLS-enforced), and the
// 'migrator' role owns DDL and may create the Prisma shadow database.

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const composeFile = 'docker-compose.dev.yml';
const superuser = envOr('POSTGRES_USER', 'werefa');
const appPassword = envOr('APP_DB_PASSWORD', 'werefa_app_dev_password');
const migratorPassword = envOr('MIGRATOR_PASSWORD', 'werefa_migrator_dev_password');

function run(args, { input, cwd = process.cwd() } = {}) {
  const result = spawnSync(args[0], args.slice(1), { stdio: ['pipe', 'inherit', 'inherit'], cwd });
  if (result.error) {
    process.stderr.write(`\nfailed to run: ${args.join(' ')}\n${result.error.message}\n`);
    process.exitCode = 1;
    return false;
  }
  return result.status === 0;
}

if (!run(['docker', 'compose', '-f', composeFile, 'up', '-d', '--wait'])) {
  process.exitCode = 1;
  process.exit();
}

const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'werefa_app') THEN
    CREATE ROLE werefa_app LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE werefa_app WITH LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'werefa_migrator') THEN
    CREATE ROLE werefa_migrator LOGIN PASSWORD '${migratorPassword.replaceAll("'", "''")}' CREATEDB NOSUPERUSER NOCREATEROLE;
  ELSE
    ALTER ROLE werefa_migrator WITH LOGIN PASSWORD '${migratorPassword.replaceAll("'", "''")}' CREATEDB NOSUPERUSER NOCREATEROLE;
  END IF;
END $$;

SELECT 'CREATE DATABASE werefa_dev OWNER werefa_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'werefa_dev')\\gexec

SELECT 'CREATE DATABASE werefa_test OWNER werefa_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'werefa_test')\\gexec

-- Keep the migrator as database owner (PG15+ public-schema defaults are tied
-- to pg_database_owner). Idempotent: no-op when ownership already correct.
ALTER DATABASE werefa_dev OWNER TO werefa_migrator;
ALTER DATABASE werefa_test OWNER TO werefa_migrator;
`;

const ok = run(['docker', 'compose', '-f', composeFile, 'exec', '-T', 'db', 'psql', '-U', superuser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql });

if (!ok) {
  process.exitCode = 1;
} else {
  console.log('provisioned roles werefa_app/werefa_migrator and databases werefa_dev/werefa_test');
}