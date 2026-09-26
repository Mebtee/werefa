import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * No-mock migration boundary for the platform-administration portal (Prompt 53).
 *
 * The Admin/Super Admin surfaces consume the real backend routes through the
 * typed API client. None of the production admin sources may flow through the
 * `@/mock/*` seam, and no admin page may fall back to a mock store for
 * authentication, accounts, security history or recovery.
 */

async function source(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

const ADMIN_SOURCES = [
  'src/api/admin.ts',
  'src/api/recovery.ts',
  'src/features/admin/AdminLayout.tsx',
  'src/features/admin/AdminDashboardPage.tsx',
  'src/features/admin/AdminAccountsPage.tsx',
  'src/features/admin/SecurityHistoryPage.tsx',
  'src/features/admin/RecoveryPage.tsx',
  'src/features/auth/RequireSuperAdmin.tsx',
]

describe('platform administration is wired to the real API', () => {
  it('the admin client calls the real routes and never the mock seam', async () => {
    const s = await source('src/api/admin.ts')
    expect(s).toMatch(/from ['"]\.\/http['"]/)
    expect(s).toMatch(/\/admin\/admins/)
    expect(s).toMatch(/\/admin\/security-history/)
    expect(s).toMatch(/\/admin\/users\/.*force-logout/)
    expect(s).not.toMatch(/@\/mock\//)
  })

  it('the recovery client posts to the real auth recovery routes', async () => {
    const s = await source('src/api/recovery.ts')
    expect(s).toMatch(/from ['"]\.\/http['"]/)
    expect(s).toMatch(/\/auth\/recovery\/request/)
    expect(s).toMatch(/\/auth\/recovery\/confirm/)
    expect(s).not.toMatch(/@\/mock\//)
  })

  it('no admin page or guard references the mock store', async () => {
    for (const path of ADMIN_SOURCES) {
      const s = await source(path)
      expect(s, `${path} must not import the mock seam`).not.toMatch(/@\/mock\//)
    }
  })

  it('the admin pages call the typed admin/auth clients', async () => {
    const accounts = await source('src/features/admin/AdminAccountsPage.tsx')
    expect(accounts).toMatch(/from ['"]@\/api\/admin['"]/)
    expect(accounts).toMatch(/listAdmins\(/)
    expect(accounts).toMatch(/createAdmin\(/)

    const security = await source('src/features/admin/SecurityHistoryPage.tsx')
    expect(security).toMatch(/authApi\.securityHistory\(/)
    expect(security).toMatch(/listPlatformSecurityHistory\(/)

    const recovery = await source('src/features/admin/RecoveryPage.tsx')
    expect(recovery).toMatch(/from ['"]@\/api\/recovery['"]/)
    expect(recovery).toMatch(/recoveryApi\.requestCode\(/)
    expect(recovery).toMatch(/recoveryApi\.confirmReset\(/)
  })

  it('the router guards every admin route with real-session gates', async () => {
    const s = await source('src/routes/router.tsx')
    expect(s).toMatch(/RequireAdmin/)
    expect(s).toMatch(/RequireSuperAdmin/)
    expect(s).toMatch(/path: '\/admin'/)
    expect(s).toMatch(/path: 'admins'/)
    expect(s).toMatch(/path: 'recovery'/)
  })
})
