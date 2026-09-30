interface Env {
  DB: D1Database;
  CROPS: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  MASTER_VERSION: string;
  ACCESS_AUD?: string;
  AUTH_DISABLED?: string;
  /** Vitest only: migrations read by vitest.config.ts. */
  TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
}

// `cloudflare:workers` types its `env` as Cloudflare.Env; keep it in step with the global Env.
declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation that only inherits
  interface Env extends globalThis.Env {}
}

declare module '*?raw' {
  const content: string;
  export default content;
}
