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

/** Result of a binary (non-JSON) download such as an owner payment proof. */
export interface ApiDownloadResponse {
  data: Blob
  /** Parsed `Content-Disposition` filename, when the server supplies one. */
  fileName: string | null
  contentType: string | null
  status: number
  requestId?: string
}

/**
 * Derives a filename from a `Content-Disposition` header, preferring the
 * RFC 5987 `filename*=UTF-8''…` form and falling back to `filename="…"`.
 */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      return extended[1].trim()
    }
  }
  const quoted = /filename="?([^";]+)"?/i.exec(header)
  return quoted ? quoted[1].trim() : null
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

  let body: BodyInit | undefined
  if (options.body !== undefined) {
    // Multipart uploads (payment proof) set their own boundary-bearing
    // Content-Type, so it must NOT be forced to application/json here.
    if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
      body = options.body
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
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

/**
 * Fetches a binary resource (Prompt 51: owner payment-proof download). Always
 * sends the session cookie; a JSON error envelope is parsed into an `ApiError`
 * exactly like `apiRequest`, while a success returns the raw `Blob` plus the
 * server-supplied filename/content type.
 */
export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiDownloadResponse> {
  const requestId = createRequestId()
  const doFetch = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await doFetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: { Accept: 'application/octet-stream', 'X-Request-Id': requestId },
      credentials: 'include',
      signal: options.signal,
    })
  } catch {
    throw ApiError.network(requestId)
  }

  const responseRequestId = response.headers.get('x-request-id') ?? requestId

  if (!response.ok) {
    if (response.status === 401 && options.handleUnauthorized !== false) {
      unauthorizedHandler?.()
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
    throw ApiError.fromResponse(response.status, parsed, responseRequestId)
  }

  const data = await response.blob()
  return {
    data,
    fileName: fileNameFromContentDisposition(response.headers.get('content-disposition')),
    contentType: response.headers.get('content-type'),
    status: response.status,
    requestId: responseRequestId,
  }
}
