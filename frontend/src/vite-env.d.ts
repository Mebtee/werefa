/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the Werefa backend API, including the `/api/v1` prefix.
   * Required for production builds; in development it falls back to
   * `http://localhost:3000/api/v1`. Never place backend secrets here.
   */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
