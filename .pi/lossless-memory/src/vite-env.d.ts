/**
 * Vite environment type declarations
 */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK_SERVER?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'production' | 'test';
    readonly VITE_API_BASE_URL?: string;
  }
}
