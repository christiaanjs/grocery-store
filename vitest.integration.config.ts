import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        remoteBindings: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ENABLE_DEV_AUTH: "true",
            DEV_TOKEN: "test-token",
            DEV_USER_ID: "usr_test",
            ENABLE_OAUTH: "true",
            JWT_SECRET: "test-jwt-secret-for-vitest-at-least-32-chars",
            GITHUB_CLIENT_ID: "test-github-client-id",
            GITHUB_CLIENT_SECRET: "test-github-client-secret",
            GOOGLE_CLIENT_ID: "test-google-client-id",
            GOOGLE_CLIENT_SECRET: "test-google-client-secret",
            INTEGRATION_SECRET: "test-integration-secret-for-vitest-32ch",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["test/mcp.integration.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
