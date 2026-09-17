/**
 * Minimal `fetch` stub for frontend tests (Prompt 44).
 *
 * Handles only what the API client needs: match a request by method + path,
 * record it, and return a `Response` with a JSON body (or 204). Install it in
 * `beforeEach` and restore in `afterEach`.
 */

export interface FetchStubRoute {
  method?: string
  /** Matched with `String(url).includes(path)`. */
  path: string
  status?: number
  body?: unknown
}

export interface RecordedRequest {
  method: string
  url: string
  body?: unknown
}

export interface FetchStub {
  calls: RecordedRequest[]
  restore(): void
}

export function installFetchStub(routes: FetchStubRoute[]): FetchStub {
  const originalFetch = globalThis.fetch
  const calls: RecordedRequest[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ method, url, body })

    const route = routes.find(
      (candidate) =>
        url.includes(candidate.path) &&
        (candidate.method ?? 'GET').toUpperCase() === method,
    )

    if (!route) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            title: 'Not found',
            detail: `No fetch stub for ${method} ${url}`,
            fields: null,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    }

    const status = route.status ?? 200
    if (status === 204) {
      return new Response(null, { status })
    }
    return new Response(JSON.stringify(route.body ?? null), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}
