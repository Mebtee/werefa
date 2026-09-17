import { apiRequest } from './http'
import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
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
}
