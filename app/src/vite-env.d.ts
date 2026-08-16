/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the aisar-api Worker. Unset = fully local, mocked. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
