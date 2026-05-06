declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    DEV_TOKEN: string;
    DEV_USER_ID: string;
    ENABLE_OAUTH: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
