// prisma migrate wrapper for the local dev environment.
//
// Migrations ALWAYS run as the 'migrator' role (DDL owner, RLS-bypass — doc 07
// §1/§4). The runtime 'app' role cannot run DDL. Usage:
//   node scripts/prisma-migrate.mjs dev
//   node scripts/prisma-migrate.mjs deploy
//   node scripts/prisma-migrate.mjs status
//   node scripts/prisma-migrate.mjs resolve --rolled-back <migration>
//
// `resolve` is Prisma's supported recovery path for a migration that failed to
// apply (typically because a role was missing). It is run through this wrapper
// too, so the bookkeeping table is only ever touched by the migrator role.

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const verb = process.argv[2];
const verbArgs = process.argv.slice(3);
if (!['dev', 'deploy', 'status', 'reset', 'resolve'].includes(verb)) {
  process.stderr.write('usage: node scripts/prisma-migrate.mjs <dev|deploy|status|reset|resolve> [args]\n');
  process.exitCode = 2;
  process.exit();
}

const migratorUrl = envOr('MIGRATOR_DATABASE_URL', '');
if (!migratorUrl) {
  process.stderr.write('MIGRATOR_DATABASE_URL is not set; configure backend/.env (see .env.example)\n');
  process.exitCode = 2;
  process.exit();
}

process.env.DATABASE_URL = migratorUrl;

// On Windows `npx` is a `npx.cmd` shim, so it must be spawned through a shell;
// `shell: true` also guards the column of the process exit status.
const result = spawnSync('npx', ['prisma', 'migrate', verb, ...verbArgs], {
  stdio: 'inherit',
  cwd: process.cwd(),
  shell: true,
});
process.exitCode = result.status ?? 1;