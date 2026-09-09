import { Client } from 'pg';

/**
 * Phase 1 — create the runtime/database roles (run BEFORE migrations).
 * Requires a superuser connection (DATABASE_URL_SUPERUSER or DATABASE_URL if
 * that URL is superuser).
 *
 * Creates: app (RLS-enforced runtime), app_superadmin (elevated audited reads),
 * migrator (DDL; BYPASSRLS, no login). Grants schema/database usage and sets
 * default privileges so future tables created by migrator are readable by app.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SUPERUSER_URL = process.env.DATABASE_URL_SUPERUSER ?? process.env.DATABASE_URL;

interface RoleSpec {
  name: string;
  password?: string;
  bypassrls?: boolean;
}

const ROLE_PASSWORD: Record<string, string> = {};
if (DATABASE_URL) {
  const u = new URL(DATABASE_URL);
  ROLE_PASSWORD[u.username] = u.password ?? '';
}
const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL;
if (MIGRATOR_URL) {
  const u = new URL(MIGRATOR_URL);
  ROLE_PASSWORD[u.username] = u.password ?? '';
}
// SuperAdmin elevated role reuses the app runtime password unless a dedicated
// DSN is provided.
const SUPERADMIN_URL = process.env.DATABASE_SUPERADMIN_URL;
if (SUPERADMIN_URL) {
  const u = new URL(SUPERADMIN_URL);
  ROLE_PASSWORD[u.username] = u.password ?? '';
}

function escapeLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

async function roleExists(client: Client, name: string): Promise<boolean> {
  const res = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  return (res.rowCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const su = new Client({ connectionString: SUPERUSER_URL ?? DATABASE_URL });
  await su.connect();

  const roles: RoleSpec[] = [
    { name: 'app', password: ROLE_PASSWORD['app'] },
    // Elevated reads; uses the app runtime password unless DATABASE_SUPERADMIN_URL given.
    { name: 'app_superadmin', password: ROLE_PASSWORD['app_superadmin'] ?? ROLE_PASSWORD['app'] },
    { name: 'migrator', password: ROLE_PASSWORD['migrator'], bypassrls: true },
  ];

  for (const role of roles) {
    if (!(await roleExists(su, role.name))) {
      const pw = role.password ? ` LOGIN PASSWORD '${escapeLiteral(role.password)}'` : ' NOLOGIN';
      const rls = role.bypassrls ? ' BYPASSRLS' : '';
      await su.query(`CREATE ROLE "${role.name}"${pw}${rls}`);
      console.log(`[roles] created ${role.name}`);
    } else {
      // Ensure login/password + bypassrls flags are applied idempotently.
      const pw = role.password ? ` LOGIN PASSWORD '${escapeLiteral(role.password)}'` : '';
      const rls = role.bypassrls ? ' BYPASSRLS' : '';
      await su.query(`ALTER ROLE "${role.name}"${pw}${rls}`);
      console.log(`[roles] ${role.name} already exists (password/flags refreshed)`);
    }
  }

  const dbName = decodeURIComponent(
    (new URL(SUPERUSER_URL ?? DATABASE_URL!).pathname ?? '').replace(/^\//, ''),
  );
  for (const name of ['app', 'app_superadmin', 'migrator']) {
    await su.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${name}"`);
    await su.query(`GRANT USAGE ON SCHEMA public TO "${name}"`);
  }
  // migrator needs DDL on the schema to run prisma migrate deploy
  await su.query(`GRANT CREATE ON SCHEMA public TO "migrator"`);
  await su.query(`GRANT CREATE ON DATABASE "${dbName}" TO "migrator"`);

  // Default privileges for tables/seqs created by migrator (all public schema)
  await eqDefaults(su, 'migrator', 'app');
  await eqDefaults(su, 'migrator', 'app_superadmin');

  await su.end();
  console.log('[roles] bootstrap complete');
}

async function eqDefaults(client: Client, owner: string, grantee: string): Promise<void> {
  // tabular privileges + sequences
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${grantee}"`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${grantee}"`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "${grantee}"`,
  );
}

main().catch((err) => {
  console.error('[roles] bootstrap failed:', err);
  process.exit(1);
});
