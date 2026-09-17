/**
 * Wire types shared by the frontend API client (Prompt 44). These mirror the
 * Prompt 43 backend contract; the backend remains authoritative.
 */

/** Internal platform roles that can authenticate. Customers have no account (REQ-040). */
export type AuthRole = 'OWNER' | 'ADMIN' | 'SUPER_ADMIN'

/** Safe server-side user projection returned by `GET /auth/session`. */
export interface AuthPrincipal {
  id: string
  role: AuthRole
  email: string
}

/** `POST /auth/login` response body. Only the safe projection is returned. */
export interface LoginResponse {
  expiresAt: string
  user: {
    id: string
    role: AuthRole
  }
}

/** `GET /auth/session` response body. `user` is null when no session is active. */
export interface SessionResponse {
  user: AuthPrincipal | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}
