// Drop and recreate the local dev/test databases (development only).
// Useful for a clean test run or to reset the migration baseline.

import { spawnSync } from 'node:child_process';
import { loadEnvFile, envOr } from './env.mjs';

loadEnvFile();

const composeFile = 'docker-compose.dev.yml';
const superuser = envOr('POSTGRES_USER', 'werefa');

const sql = `
DROP DATABASE IF EXISTS werefa_test WITH (FORCE);
DROP DATABASE IF EXISTS werefa_dev WITH (FORCE);
CREATE DATABASE werefa_dev OWNER werefa_migrator;
CREATE DATABASE werefa_test OWNER werefa_migrator;
`;

const args = ['docker', 'compose', '-f', composeFile, 'exec', '-T', 'db', 'psql', '-U', superuser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const result = spawnSync(args[0], args.slice(1), { stdio: ['pipe', 'inherit', 'inherit'], input: sql });
if (result.status !== 0 || result.error) {
  process.exitCode = 1;
}