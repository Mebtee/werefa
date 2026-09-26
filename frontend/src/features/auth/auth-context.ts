import { createContext } from 'react'
import type { AuthPrincipal } from '@/api/types'

/**
 * Authentication state shared across the frontend (Prompt 44).
 *
 * Statuses:
 *  - `loading`        — restoring the session on first load;
 *  - `unauthenticated`— no valid session (or the session was rejected);
 *  - `authenticating` — a login request is in flight;
 *  - `authenticated`  — a verified principal is present;
 *  - `error`          — restoration failed for a non-auth reason (network/5xx).
 *
 * The client never persists credentials or role in localStorage/sessionStorage;
 * the only session artifact is the backend's HttpOnly cookie.
 */
export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'error'

export interface AuthState {
  status: AuthStatus
  principal: AuthPrincipal | null
  error: string | null
}

export interface AuthCredentials {
  email: string
  password: string
}

export interface AuthContextValue extends AuthState {
  login(credentials: AuthCredentials): Promise<boolean>
  /**
   * Owner self-service registration (Prompt 54; REQ-005/009/032). The backend
   * creates an unverified account and signs the owner straight in (auto-login),
   * so this returns true only when the new session is active. Never attempts to
   * present or store any credential client-side.
   */
  register(credentials: AuthCredentials): Promise<boolean>
  logout(): Promise<void>
  refresh(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
