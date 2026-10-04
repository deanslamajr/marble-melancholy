/// <reference types="vite/client" />

declare const BUILD_VERSION: string;
declare const BUILD_COMMIT: string;

interface ImportMetaEnv {
  readonly VITE_FEEDBACK_URL?: string;
}
