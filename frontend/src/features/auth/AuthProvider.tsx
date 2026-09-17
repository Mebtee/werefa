import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { authApi } from '@/api/auth'
import { isAuthenticationError, toUserMessage } from '@/api/errors'
import { setUnauthorizedHandler } from '@/api/http'
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context'

const LOADING_STATE: AuthState = { status: 'loading', principal: null, error: null }
const UNAUTHENTICATED_STATE: AuthState = {
  status: 'unauthenticated',
  principal: null,
  error: null,
}

interface AuthProviderProps {
  children: ReactNode
  /**
   * Test seam: when provided, the initial session restoration is skipped and
   * the supplied state is used as-is.
   */
  initialState?: AuthState
}

/**
 * Owns the single source of authentication truth for the app. It restores the
 * session from the backend cookie on mount, exposes login/logout/refresh, and
 * reacts to a global `401` by clearing the principal.
 */
export function AuthProvider({ children, initialState }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(initialState ?? LOADING_STATE)
  const skipInitialBootstrap = useRef(initialState !== undefined)

  const refresh = useCallback(async () => {
    setState(LOADING_STATE)
    try {
      const { data } = await authApi.session()
      if (data.user) {
        setState({ status: 'authenticated', principal: data.user, error: null })
      } else {
        setState(UNAUTHENTICATED_STATE)
      }
    } catch (error) {
      if (isAuthenticationError(error)) {
        setState(UNAUTHENTICATED_STATE)
      } else {
        setState({ status: 'error', principal: null, error: toUserMessage(error) })
      }
    }
  }, [])

  useEffect(() => {
    if (skipInitialBootstrap.current) return
    void refresh()
  }, [refresh])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((current) =>
        current.status === 'unauthenticated' ? current : UNAUTHENTICATED_STATE,
      )
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (credentials: { email: string; password: string }) => {
    setState({ status: 'authenticating', principal: null, error: null })
    try {
      const { data } = await authApi.login(credentials)
      setState({
        status: 'authenticated',
        principal: {
          id: data.user.id,
          role: data.user.role,
          email: credentials.email.trim().toLowerCase(),
        },
        error: null,
      })
      return true
    } catch (error) {
      setState({ status: 'error', principal: null, error: toUserMessage(error) })
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Signing out locally must succeed even if the server cannot be reached.
    }
    setState(UNAUTHENTICATED_STATE)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, refresh }),
    [state, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
