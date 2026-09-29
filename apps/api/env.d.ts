interface Env {
  DB: D1Database;
  CROPS: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  MASTER_VERSION: string;
  ACCESS_AUD?: string;
  AUTH_DISABLED?: string;
}
