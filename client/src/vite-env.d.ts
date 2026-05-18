/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TERMINAL_WS_URL?: string
  readonly VITE_WS_URL?: string
  readonly VITE_SEARXNG_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
