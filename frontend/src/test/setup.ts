import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})

/**
 * No test may reach the real network.
 *
 * The suite layers stubs by replacing `globalThis.fetch` and delegating to
 * whatever was installed before them, so the bottom of that chain must fail
 * loudly rather than hit a real host. Without this, a developer's running
 * backend on :3000 answers unstubbed routes (for example a 401 for an
 * unauthenticated owner call), and the same commit passes or fails depending on
 * whether that server happens to be up.
 */
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof URL ? input.href : String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  return Promise.reject(
    new Error(
      `Unstubbed network request in a frontend test: ${method} ${url}. ` +
        'Install a stub (installFetchStub / installBusinessApiStub) or model ' +
        'the route in the double.',
    ),
  )
}) as typeof fetch
;(globalThis as Record<string, unknown>).__realFetch = realFetch

// jsdom does not implement fetch, so the global Request is Node's undici
// implementation, which requires the AbortSignal passed to it to be an
// instance of Node's own AbortSignal. jsdom installs its own AbortController,
// whose signals fail that check ("RequestInit: Expected signal to be an
// instance of AbortSignal"). React Router's data router constructs a
// client-side Request on every navigate(), so replace Request with a small
// compatible shim when the mismatch is present.
const g = globalThis as Record<string, unknown>
const NativeRequest = g.Request as typeof Request | undefined
if (typeof NativeRequest === 'function') {
  const AbortCtrl = g.AbortController as typeof AbortController | undefined
  let needsShim = false
  try {
    if (AbortCtrl) {
      new NativeRequest('https://example.com', { signal: new AbortCtrl().signal })
    }
  } catch {
    needsShim = true
  }
  if (needsShim) {
    const HeadersCtor = (g.Headers as typeof Headers | undefined) ?? null

    class CompatRequest {
      readonly url: string
      readonly method: string
      readonly headers: Headers | null
      readonly signal: AbortSignal | null
      readonly body: BodyInit | null
      constructor(input: RequestInfo | URL, init: RequestInit = {}) {
        this.url = input instanceof URL ? input.href : String(input)
        this.method = (init.method ?? 'GET').toUpperCase()
        this.signal = init.signal ?? null
        this.body = (init.body as BodyInit | null) ?? null
        this.headers = HeadersCtor ? new HeadersCtor(init.headers) : null
      }
      async text(): Promise<string> {
        return typeof this.body === 'string' ? this.body : ''
      }
      async json(): Promise<unknown> {
        return JSON.parse(await this.text())
      }
      async formData(): Promise<FormData> {
        throw new Error('formData() is not supported by the test Request shim.')
      }
    }

    g.Request = CompatRequest as unknown as typeof Request
  }
}