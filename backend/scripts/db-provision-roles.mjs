// Create or align the two architecture roles on an already-provisioned
// PostgreSQL instance (doc 07 §1/§4):
//
//   werefa_migrator -> DDL owner; runs Prisma Migrate
//   werefa_app      -> runtime DML only (SELECT/INSERT/UPDATE/DELETE)
//
// This is the managed-PostgreSQL counterpart of scripts/db-provision.mjs, which
// is tied to the local Docker container and also creates the werefa_dev and
// werefa_test databases. Databases are NEVER created, dropped or altered here —
// only roles and the minimum grants Werefa's migration history assumes:
//
//   * werefa_app must already exist when migration 1 runs
//     (GRANT ... TO "werefa_app").
//   * werefa_migrator must be the role that RUNS the migrations, because the
//     history ends with ALTER DEFAULT PRIVILEGES FOR ROLE "werefa_migrator" and
//     only that role (or a superuser) may change its default privileges. Running
//     Migrate as any other role fails with 42501.
//
// Privileges are deliberately minimal: neither role is a superuser, neither
// bypasses RLS, and werefa_app never receives CREATE. werefa_migrator keeps its
// existing CREATEDB attribute untouched — only `prisma migrate dev` (shadow
// database) needs it, and self-hosted provisioning grants it separately.
//
// Usage:
//   npm run db:provision:roles
//
// Requires POSTGRES_ADMIN_DATABASE_URL (an administrative connection, e.g. the
// Supabase `postgres` role or the Docker superuser) plus APP_DB_PASSWORD and
// MIGRATOR_PASSWORD. Passwords are read from the environment and are never
// written into source or migrations.

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const adminUrl = envOr('POSTGRES_ADMIN_DATABASE_URL', '');
if (!adminUrl) {
  process.stderr.write(
    'POSTGRES_ADMIN_DATABASE_URL is not set; configure backend/.env (see .env.example)\n',
  );
  process.exitCode = 2;
  process.exit();
}

const appPassword = envOr('APP_DB_PASSWORD', '');
const migratorPassword = envOr('MIGRATOR_PASSWORD', '');
if (!appPassword || !migratorPassword) {
  process.stderr.write('APP_DB_PASSWORD and MIGRATOR_PASSWORD must both be set (see .env.example)\n');
  process.exitCode = 2;
  process.exit();
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const quoteIdent = (value) => `"${value.replaceAll('"', '""')}"`;

const targetDatabase = (() => {
  try {
    return new URL(adminUrl).pathname.replace(/^\//, '') || 'postgres';
  } catch {
    return 'postgres';
  }
})();

const sql = `-- Werefa role provisioning (idempotent; roles + grants only).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'werefa_app') THEN
    CREATE ROLE werefa_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'werefa_migrator') THEN
    CREATE ROLE werefa_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Only LOGIN and the password are set here. The superuser / BYPASSRLS /
-- CREATEDB / CREATEROLE attributes are deliberately NOT touched: on managed
-- PostgreSQL the administrative role holds CREATEROLE but not SUPERUSER, so it
-- is not allowed to change them (PostgreSQL rejects the statement outright), and
-- werefa_migrator must keep CREATEDB where self-hosted provisioning granted it
-- (Prisma's shadow database for 'migrate dev'). The guard below fails loudly if
-- either role was ever made over-privileged.
ALTER ROLE werefa_app WITH LOGIN PASSWORD ${quote(appPassword)};
ALTER ROLE werefa_migrator WITH LOGIN PASSWORD ${quote(migratorPassword)};

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('werefa_app', 'werefa_migrator')
      AND (rolsuper OR rolbypassrls OR rolcreaterole)
  ) THEN
    RAISE EXCEPTION
      'werefa_app/werefa_migrator must not be SUPERUSER, BYPASSRLS or CREATEROLE; fix the role attributes out of band';
  END IF;
END $$;

GRANT CONNECT ON DATABASE ${quoteIdent(targetDatabase)} TO werefa_app, werefa_migrator;

-- werefa_migrator needs CREATE to run the migration history; werefa_app only USAGE.
GRANT USAGE, CREATE ON SCHEMA public TO werefa_migrator;
GRANT USAGE ON SCHEMA public TO werefa_app;

-- Prisma Migrate bookkeeping. When the table was created by another role
-- (e.g. the first 'migrate deploy' run as the admin role) the migrator would
-- otherwise be denied on _prisma_migrations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
  ) THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public._prisma_migrations TO werefa_migrator';
  END IF;
END $$;
`;

// `prisma db execute` sends the script as a single command; process.env wins over
// any .env value, so the administrative connection never has to be written down.
const result = spawnSync(
  'npx',
  ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'],
  {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: process.cwd(),
    shell: true,
    env: { ...process.env, DATABASE_URL: adminUrl },
  },
);

if (result.error) {
  process.stderr.write(`\nfailed to run prisma db execute: ${result.error.message}\n`);
  process.exitCode = 1;
  process.exit();
}

if (result.status !== 0) {
  process.stderr.write('\nrole provisioning failed\n');
  process.exitCode = result.status ?? 1;
  process.exit();
}

process.stdout.write('provisioned roles werefa_app/werefa_migrator (no databases created)\n');
process.stdout.write('next: npm run prisma:deploy\n');
