/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_TENANT_SLUG?: string;
  readonly VITE_APP_ENVIRONMENT?: 'development' | 'sandbox' | 'test' | 'production';
  readonly VITE_SUPPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
