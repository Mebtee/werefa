import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVELOPMENT_API_BASE_URL, resolveApiBaseUrl } from './config'
import { ApiError, toFieldErrors, toUserMessage } from './errors'
import { apiRequest, setUnauthorizedHandler } from './http'

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

afterEach(() => {
  setUnauthorizedHandler(null)
})

describe('resolveApiBaseUrl', () => {
  it('trims trailing slashes from a configured base URL', () => {
    expect(resolveApiBaseUrl('http://api.test/api/v1/', true)).toBe(
      'http://api.test/api/v1',
    )
  })

  it('falls back to the local backend in development', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe(DEVELOPMENT_API_BASE_URL)
  })

  it('throws when no base URL is configured for a production build', () => {
    expect(() => resolveApiBaseUrl(undefined, false)).toThrow(
      /VITE_API_BASE_URL/,
    )
  })

  it('ignores a blank configured value and uses the dev fallback', () => {
    expect(resolveApiBaseUrl('   ', true)).toBe(DEVELOPMENT_API_BASE_URL)
  })
})

describe('apiRequest', () => {
  it('targets the configured base URL with the session cookie and request id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    const res = await apiRequest<{ ok: boolean }>('/auth/session', { fetchImpl })

    expect(res.data).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DEVELOPMENT_API_BASE_URL}/auth/session`)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Request-Id']).toBeTruthy()
    expect(headers.Accept).toBe('application/json')
  })

  it('serializes a JSON body and sets Content-Type on POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'owner@werefa.test', password: 'secret' },
      fetchImpl,
    })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(
      JSON.stringify({ email: 'owner@werefa.test', password: 'secret' }),
    )
  })

  it('appends query parameters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    await apiRequest('/owner/bookings', {
      query: { status: 'confirmed', page: 2, missing: undefined },
      fetchImpl,
    })
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('status=confirmed')
    expect(url).toContain('page=2')
    expect(url).not.toContain('missing')
  })

  it('returns undefined data for 204 responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    const res = await apiRequest<void>('/auth/logout', {
      method: 'POST',
      fetchImpl,
    })
    expect(res.status).toBe(204)
    expect(res.data).toBeUndefined()
  })

  it('maps an error envelope onto a typed ApiError', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            title: 'Validation failed',
            detail: 'Check the fields.',
            fields: { email: 'Email is required.' },
          },
        }),
      ),
    )
    const error = await apiRequest('/auth/login', { fetchImpl }).catch((e) => e)
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      kind: 'validation',
    })
    expect(toFieldErrors(error)).toEqual({ email: 'Email is required.' })
  })

  it('classifies a 423 lockout', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(423, {
        error: { code: 'ACCOUNT_LOCKED', title: 'Locked', fields: null },
      }),
    )
    await expect(apiRequest('/auth/login', { fetchImpl })).rejects.toMatchObject({
      kind: 'locked',
    })
  })

  it('turns a transport failure into a network ApiError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'))
    const error = await apiRequest('/auth/login', { fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('network')
  })

  it('handles a non-envelope error body safely', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 }))
    const error = await apiRequest('/auth/session', { fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('UNEXPECTED_RESPONSE')
    expect((error as ApiError).kind).toBe('server')
    expect(toUserMessage(error)).toBe(
      'Something went wrong on our side. Please try again.',
    )
  })

  it('invokes the global unauthorized handler on 401 by default', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: 'UNAUTHENTICATED', title: 'No', fields: null },
      }),
    )
    await expect(apiRequest('/owner/bookings', { fetchImpl })).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the handler when handleUnauthorized is false', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: 'UNAUTHENTICATED', title: 'No', fields: null },
      }),
    )
    await expect(
      apiRequest('/auth/session', { fetchImpl, handleUnauthorized: false }),
    ).rejects.toThrow()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('toUserMessage', () => {
  it('never echoes raw backend detail for authentication failures', () => {
    const error = ApiError.fromResponse(
      401,
      {
        error: {
          code: 'UNAUTHENTICATED',
          title: 'Invalid credentials',
          detail: 'user 7f3a not found in table users',
          fields: null,
        },
      },
      'req-1',
    )
    expect(toUserMessage(error)).toBe('Your email or password is incorrect.')
    expect(toUserMessage(error)).not.toContain('7f3a')
  })
})
