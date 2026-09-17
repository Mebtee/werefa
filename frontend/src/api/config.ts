/**
 * Resolves the backend API base URL for HTTP requests.
 *
 * `VITE_API_BASE_URL` is the only supported source (Prompt 44). A development
 * fallback keeps `npm run dev` working without a local `.env.local`, but a
 * production build MUST configure the value explicitly: we never ship a
 * hard-coded localhost origin, so an unset production base URL throws rather
 * than silently pointing at a developer machine.
 */
export const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000/api/v1'

export function resolveApiBaseUrl(
  raw: string | undefined = import.meta.env.VITE_API_BASE_URL,
  isDev: boolean = import.meta.env.DEV,
): string {
  const trimmed = raw?.trim()
  if (trimmed) {
    return trimmed.replace(/\/+$/, '')
  }
  if (isDev) {
    return DEVELOPMENT_API_BASE_URL
  }
  throw new Error(
    'VITE_API_BASE_URL is not configured. Set it before building the frontend for production.',
  )
}
