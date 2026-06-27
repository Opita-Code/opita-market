/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("./lib/cognito-sso-consumer").CognitoUser | null;
    requestId: string;
  }
}

interface ImportMetaEnv {
  readonly JWT_SECRET: string;
  readonly PUBLIC_API_URL: string;
  readonly PUBLIC_SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}