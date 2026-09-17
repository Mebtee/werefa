import { resolveApiBaseUrl } from './config'
import { ApiError } from './errors'

/**
 * Thin, typed HTTP client for the Werefa backend (Prompt 44).
 *
 * Responsibilities:
 *  - build the request URL from the single configured API base URL;
 *  - always send the HttpOnly session cookie (`credentials: 'include'`);
 *  - attach a correlation `X-Request-Id`;
 *  - parse the architecture error envelope into an `ApiError`;
 *  - notify a single global handler on `401` so an expired/revoked session can
 *    be surfaced app-wide without every caller re-implementing it.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequestOptions {
  method?: HttpMethod
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /**
   * When false, a `401` response does not invoke the global unauthorized
   * handler (used by the auth calls that legitimately probe/clear the session).
   */
  handleUnauthorized?: boolean
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

export interface ApiResponse<T> {
  data: T
  status: number
  requestId?: string
}

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

/** Registers the single global handler invoked when a request returns 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

function createRequestId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function buildUrl(path: string, query: ApiRequestOptions['query']): string {
  const base = resolveApiBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${base}${normalizedPath}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const requestId = createRequestId()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': requestId,
  }

  let body: string | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const doFetch = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await doFetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    })
  } catch {
    throw ApiError.network(requestId)
  }

  const responseRequestId = response.headers.get('x-request-id') ?? requestId

  if (response.status === 204) {
    return { data: undefined as T, status: 204, requestId: responseRequestId }
  }

  const text = await response.text()
  let parsed: unknown
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
  }

  if (!response.ok) {
    if (response.status === 401 && options.handleUnauthorized !== false) {
      unauthorizedHandler?.()
    }
    throw ApiError.fromResponse(response.status, parsed, responseRequestId)
  }

  return { data: parsed as T, status: response.status, requestId: responseRequestId }
}
