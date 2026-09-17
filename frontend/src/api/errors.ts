/**
 * Centralized API error model (Prompt 44).
 *
 * The backend always responds with the architecture envelope
 * `{ error: { code, title, detail, fields } }` (doc 23 §2 / spec §33). This
 * module turns that — plus transport failures — into a typed `ApiError` and
 * derives safe, user-facing messages. Raw backend internals are never rendered
 * directly; the UI maps through `toUserMessage` / `toFieldErrors`.
 */

export type ApiErrorKind =
  | 'network'
  | 'validation'
  | 'authentication'
  | 'forbidden'
  | 'locked'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'server'
  | 'unknown'

interface ErrorEnvelopeBody {
  error?: {
    code?: unknown
    title?: unknown
    detail?: unknown
    fields?: unknown
  }
}

export interface ApiErrorInit {
  status: number
  code: string
  title: string
  detail?: string | null
  fields?: Record<string, string> | null
  requestId?: string
}

const CODE_TO_KIND: Record<string, ApiErrorKind> = {
  VALIDATION_ERROR: 'validation',
  UNAUTHENTICATED: 'authentication',
  TOKEN_EXPIRED: 'authentication',
  INVALID_SIGNATURE: 'authentication',
  VERIFICATION_REQUIRED: 'forbidden',
  FORBIDDEN: 'forbidden',
  ACCOUNT_LOCKED: 'locked',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  TOKEN_USED: 'conflict',
  SLOT_UNAVAILABLE: 'conflict',
  PAYMENT_REJECTED: 'conflict',
  PAYMENT_PENDING: 'conflict',
  INVALID_TRANSITION: 'conflict',
  SCHEDULE_AFFECTED: 'conflict',
  RATE_LIMITED: 'rate-limited',
  INTERNAL_ERROR: 'server',
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 0) return 'network'
  if (status === 400) return 'validation'
  if (status === 401) return 'authentication'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 423) return 'locked'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'unknown'
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly title: string
  readonly detail?: string | null
  readonly fields?: Record<string, string> | null
  readonly requestId?: string
  readonly kind: ApiErrorKind

  constructor(init: ApiErrorInit) {
    super(init.title)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.title = init.title
    this.detail = init.detail ?? null
    this.fields = init.fields ?? null
    this.requestId = init.requestId
    this.kind = CODE_TO_KIND[init.code] ?? kindForStatus(init.status)
  }

  get isAuthentication(): boolean {
    return this.kind === 'authentication'
  }

  get isValidation(): boolean {
    return this.kind === 'validation'
  }

  get isForbidden(): boolean {
    return this.kind === 'forbidden'
  }

  static network(requestId?: string): ApiError {
    return new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      title: 'Network error',
      detail: 'The server could not be reached.',
      requestId,
    })
  }

  static fromResponse(status: number, body: unknown, requestId?: string): ApiError {
    const envelope = (body as ErrorEnvelopeBody | null)?.error
    if (envelope && typeof envelope.code === 'string') {
      const title = typeof envelope.title === 'string' ? envelope.title : envelope.code
      const detail = typeof envelope.detail === 'string' ? envelope.detail : null
      const fields = normalizeFields(envelope.fields)
      return new ApiError({ status, code: envelope.code, title, detail, fields, requestId })
    }
    return new ApiError({
      status,
      code: 'UNEXPECTED_RESPONSE',
      title: 'Unexpected server response',
      detail: 'The server returned an unexpected response.',
      requestId,
    })
  }
}

function normalizeFields(fields: unknown): Record<string, string> | null {
  if (!fields || typeof fields !== 'object') return null
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value
  }
  return Object.keys(result).length > 0 ? result : null
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isAuthenticationError(error: unknown): boolean {
  return isApiError(error) && error.isAuthentication
}

/** Maps any thrown error to a safe, human-readable message for the UI. */
export function toUserMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Something went wrong. Please try again.'
  }
  switch (error.kind) {
    case 'network':
      return "We couldn't reach the server. Check your connection and try again."
    case 'authentication':
      return 'Your email or password is incorrect.'
    case 'forbidden':
      return 'You do not have permission to do that.'
    case 'locked':
      return 'Too many failed attempts. Please try again in about 15 minutes.'
    case 'rate-limited':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'validation':
      return error.detail ?? 'Please check the highlighted fields and try again.'
    case 'not-found':
      return 'We could not find what you were looking for.'
    case 'conflict':
      return error.detail ?? 'That action conflicts with the current state. Please refresh and try again.'
    case 'server':
      return 'Something went wrong on our side. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

/** Extracts per-field validation messages (e.g. `{ email: '...' }`) if present. */
export function toFieldErrors(error: unknown): Partial<Record<string, string>> {
  if (!isApiError(error) || !error.fields) return {}
  return { ...error.fields }
}
