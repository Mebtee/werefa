import { apiRequest } from './http'
import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  SecurityEventView,
  SessionResponse,
} from './types'

/**
 * Authentication endpoints (Prompt 43 backend contract). These are the only
 * calls that manage the session cookie; the cookie is HttpOnly and never
 * touched by JavaScript.
 */
export const authApi = {
  login(input: LoginRequest) {
    return apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: input,
      handleUnauthorized: false,
    })
  },

  /** Owner self-service registration (Prompt 54; REQ-005/009/032); auto-login. */
  register(input: RegisterRequest) {
    return apiRequest<LoginResponse>('/auth/register', {
      method: 'POST',
      body: input,
      handleUnauthorized: false,
    })
  },

  /** Idempotent server-side session revocation. */
  logout() {
    return apiRequest<void>('/auth/logout', {
      method: 'POST',
      handleUnauthorized: false,
    })
  },

  /** Resolves the current principal from the session cookie (session restoration). */
  session() {
    return apiRequest<SessionResponse>('/auth/session', {
      method: 'GET',
      handleUnauthorized: false,
    })
  },

  changePassword(input: ChangePasswordRequest) {
    return apiRequest<void>('/auth/password/change', {
      method: 'POST',
      body: input,
    })
  },

  /** The caller's own security/activity history (REQ-201 Owner, REQ-202 Admin). */
  securityHistory(signal?: AbortSignal) {
    return apiRequest<{ events: SecurityEventView[] }>('/auth/security', {
      method: 'GET',
      signal,
    }).then(({ data }) => data.events)
  },
}
