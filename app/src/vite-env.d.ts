/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the aisar-api Worker. Unset = fully local, mocked. */
  readonly VITE_API_URL?: string;
  /** Exact one-route credential-deposit edge. Must match the URL the API
      returns before the browser will release credential material. */
  readonly VITE_VAULT_DEPOSIT_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
