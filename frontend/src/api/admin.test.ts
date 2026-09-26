import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAdmin,
  deactivateAdmin,
  deleteSecurityHistory,
  forceLogoutUser,
  listAdmins,
  listPlatformSecurityHistory,
  listScheduleVersions,
  resetAdminPassword,
} from './admin'
import { authApi } from './auth'
import { recoveryApi } from './recovery'
import type { AdminUserView, SecurityEventView } from './types'

/**
 * Contract tests for the Prompt 53 platform-administration client: every call
 * must use exactly the implemented backend route, method and body, and unwrap
 * the documented envelope. The client never supplies a role, actor or tenant
 * id — authorization comes from the session cookie.
 */

const BASE = 'http://localhost:3000/api/v1'

const ADMIN: AdminUserView = {
  id: '00000000-0000-4000-8000-0000000000a',
  email: 'admin@werefa.test',
  createdAt: '2026-01-01T00:00:00.000Z',
  isDeactivated: false,
  activeSessions: 1,
}

const EVENT: SecurityEventView = {
  id: 'evt-1',
  type: 'LOGIN_SUCCEEDED',
  ip: '127.0.0.1',
  device: 'desktop',
  browser: 'Chrome',
  result: 'SUCCESS',
  createdAt: '2026-01-01T00:00:00.000Z',
}

interface RecordedCall {
  url: string
  init?: RequestInit
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.stubGlobal(
    'fetch',
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : String(input)
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof fetch,
  )
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin account management', () => {
  it('GETs the Admin list and unwraps the admins array', async () => {
    const calls = stubFetch(() => jsonResponse({ admins: [ADMIN] }))
    const result = await listAdmins()

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/admins`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(result).toEqual([ADMIN])
  })

  it('POSTs a new Admin with only the supplied fields', async () => {
    const calls = stubFetch(() => jsonResponse({ admin: ADMIN }))
    const result = await createAdmin({
      email: 'admin@werefa.test',
      password: 'correct-horse-battery',
      recoveryEmail: 'recovery@werefa.test',
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/admins`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'admin@werefa.test',
      password: 'correct-horse-battery',
      recoveryEmail: 'recovery@werefa.test',
    })
    expect(result).toEqual(ADMIN)
  })

  it('DELETEs an Admin by id (deactivation)', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))
    await deactivateAdmin(ADMIN.id)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/admins/${ADMIN.id}`)
    expect(init?.method).toBe('DELETE')
  })

  it('POSTs a password reset to the Admin password route', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))
    await resetAdminPassword(ADMIN.id, 'new-secret-123')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/admins/${ADMIN.id}/password`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ newPassword: 'new-secret-123' })
  })

  it('POSTs a force-logout for any user id', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))
    await forceLogoutUser('owner-1')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/users/owner-1/force-logout`)
    expect(init?.method).toBe('POST')
  })
})

describe('platform security history', () => {
  it('GETs the platform-wide history and unwraps the events array', async () => {
    const calls = stubFetch(() => jsonResponse({ events: [EVENT] }))
    const result = await listPlatformSecurityHistory()

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/security-history`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual([EVENT])
  })

  it('DELETEs records older than an instant and returns the deleted count', async () => {
    const calls = stubFetch(() => jsonResponse({ deleted: 3 }))
    const result = await deleteSecurityHistory('2025-01-01T00:00:00.000Z')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/security-history`)
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(init?.body as string)).toEqual({
      olderThan: '2025-01-01T00:00:00.000Z',
    })
    expect(result).toBe(3)
  })

  it('GETs an Admin own history from the auth route', async () => {
    const calls = stubFetch(() => jsonResponse({ events: [EVENT] }))
    const result = await authApi.securityHistory()

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/auth/security`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual([EVENT])
  })
})

describe('schedule version history', () => {
  it('GETs the Super Admin schedule-version history for a business', async () => {
    const calls = stubFetch(() => jsonResponse([]))
    await listScheduleVersions('biz-1')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/admin/businesses/biz-1/schedule/versions`)
    expect(init?.method ?? 'GET').toBe('GET')
  })
})

describe('Super Admin emergency recovery', () => {
  it('POSTs a recovery-code request and returns the generic message', async () => {
    const calls = stubFetch(() => jsonResponse({ message: 'If the account exists, a code was sent.' }))
    const message = await recoveryApi.requestCode({ email: 'superadmin@werefa.test' })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/auth/recovery/request`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'superadmin@werefa.test' })
    expect(message).toBe('If the account exists, a code was sent.')
  })

  it('POSTs the code confirmation with the new password', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }))
    await recoveryApi.confirmReset({
      email: 'superadmin@werefa.test',
      code: '123456',
      newPassword: 'brand-new-secret',
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/auth/recovery/confirm`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'superadmin@werefa.test',
      code: '123456',
      newPassword: 'brand-new-secret',
    })
  })
})
