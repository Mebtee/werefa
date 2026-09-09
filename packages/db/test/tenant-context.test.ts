import { describe, it, expect } from 'vitest';
import { tenantContextSql, GUC } from '../src';

describe('tenantContextSql', () => {
  it('renders a single SELECT statement with each GUC as a set_config column', () => {
    const sql = tenantContextSql({ userId: 'u-1', businessId: 'b-1', scope: 'SUPER_ADMIN' });
    // Single command — no statement separators (Prisma extended protocol).
    expect(sql.startsWith('SELECT ')).toBe(true);
    expect(sql).not.toContain(';');
    expect(sql).toContain(`set_config('${GUC.userId}', 'u-1', true)`);
    expect(sql).toContain(`set_config('${GUC.businessId}', 'b-1', true)`);
    expect(sql).toContain(`set_config('${GUC.scope}', 'SUPER_ADMIN', true)`);
  });

  it('escapes injected single quotes (golden rendering, safe literal)', () => {
    const sql = tenantContextSql({
      userId: "vicky'; DROP TABLE user; --",
      businessId: 'abc',
    });
    expect(sql).toBe(
      "SELECT set_config('app.user_id', 'vicky''; DROP TABLE user; --', true), " +
        "set_config('app.business_id', 'abc', true), " +
        "set_config('app.scope', 'OWNER', true)",
    );
    // Every single-quote in the produced SQL belongs to a paired literal; the
    // injected quote was doubled, so no quote can close a literal and let
    // `;` start a new command.
    let inLiteral = false;
    for (const ch of sql) {
      if (ch === "'") inLiteral = !inLiteral;
    }
    expect(inLiteral).toBe(false);
  });

  it('omits businessId when absent and defaults scope to OWNER', () => {
    const sql = tenantContextSql({ userId: 'u-1' });
    expect(sql).toContain(`set_config('${GUC.userId}'`);
    expect(sql).toContain(`set_config('${GUC.scope}', 'OWNER', true)`);
    expect(sql).not.toContain(`${GUC.businessId}`);
  });

  it('defaults scope to PUBLIC for anonymous contexts', () => {
    const sql = tenantContextSql({});
    expect(sql).toContain(`set_config('${GUC.scope}', 'PUBLIC', true)`);
    expect(sql).not.toContain('app.user_id');
  });

  it('uses transaction-local (is_local=true) settings', () => {
    const sql = tenantContextSql({ userId: 'u-1' });
    // set_config with true keeps the value scoped to the current transaction.
    expect(sql).toContain(', true)');
  });
});
