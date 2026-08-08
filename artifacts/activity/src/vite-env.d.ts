/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application (client) id — set at build/deploy time. */
  readonly VITE_DISCORD_CLIENT_ID?: string;
  /** Override the API base. Defaults to the Discord proxy path in-frame. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
