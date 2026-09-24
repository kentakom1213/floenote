/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_COORDINATOR_URL?: string;
  readonly VITE_WEB_VERSION?: string;
  readonly VITE_WEB_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
