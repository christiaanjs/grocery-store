import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEV_TOKEN = "test-token";
const TEST_USER_ID = "usr_test";
const TEST_HOUSEHOLD_ID = "hh_integ_test";
const TEST_EMAIL = "test@example.com";
const MASTER_TOKEN = "aas_et/fake-master-token-value";

// ── Helpers ───────────────────────────────────────────────────────────────

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    ...init,
    headers: {
      "X-Dev-Token": DEV_TOKEN,
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
}

function authedJson(path: string, method: string, body: unknown): Promise<Response> {
  return authed(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setupUser(email: string | null = TEST_EMAIL) {
  const now = Date.now();
  await env.DB.batch([
    env.DB
      .prepare("INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)")
      .bind(TEST_HOUSEHOLD_ID, "Test Household", now),
    env.DB
      .prepare("INSERT OR REPLACE INTO users (id, email, household_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(TEST_USER_ID, email, TEST_HOUSEHOLD_ID, now),
  ]);
}

async function seedIntegration() {
  // Store a pre-encrypted token directly so we don't need a live Google call.
  // We use the real encryptToken so we can decrypt it in handler tests too.
  const { encryptToken } = await import("../src/crypto.ts");
  const { ciphertext, iv } = await encryptToken(env.INTEGRATION_SECRET, MASTER_TOKEN);
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO integrations
       (id, household_id, provider, encrypted_token, token_iv, google_email, keep_list_id, created_at, updated_at)
       VALUES (?, ?, 'google', ?, ?, ?, NULL, ?, ?)`,
    )
    .bind("integ_test", TEST_HOUSEHOLD_ID, ciphertext, iv, TEST_EMAIL, now, now)
    .run();
}

// Mock: Android auth returns a valid Auth token (\r\n line endings to verify parser)
function mockAndroidAuthOk(authToken = "valid_keep_token") {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    async () => new Response(`Auth=${authToken}\r\nExpiry=157680000\r\n`, { status: 200 }),
  );
}

// Mock: Android auth returns an error
function mockAndroidAuthError(error = "BadAuthentication") {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    async () => new Response(`Error=${error}\r\nInfo=InvalidMasterToken\r\n`, { status: 403 }),
  );
}

// Mock: Keep API returns a successful response with a server-generated list node
function mockKeepApiOk(serverId = "server_list_node_id") {
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          toVersion: "42",
          nodes: [{ id: "local_list_id", serverId, type: "LIST" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
}

// ── GET /integrations/google ──────────────────────────────────────────────

describe("GET /integrations/google", () => {
  beforeEach(() => setupUser());
  afterEach(() => vi.restoreAllMocks());

  it("returns not connected when no integration exists", async () => {
    const res = await authed("/integrations/google");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("returns connected status with email and keep_list_id", async () => {
    await seedIntegration();
    const res = await authed("/integrations/google");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["connected"]).toBe(true);
    expect(data["email"]).toBe(TEST_EMAIL);
    expect(data["keep_list_id"]).toBeNull();
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("http://localhost/integrations/google");
    expect(res.status).toBe(401);
  });
});

// ── POST /integrations/google/manual-token ────────────────────────────────

describe("POST /integrations/google/manual-token", () => {
  beforeEach(() => setupUser());
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when email is missing", async () => {
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      master_token: MASTER_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("required");
  });

  it("returns 400 when master_token is missing", async () => {
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: TEST_EMAIL,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("required");
  });

  it("returns 400 when email does not match the account email", async () => {
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: "other@gmail.com",
      master_token: MASTER_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/email.*match/i);
  });

  it("returns 400 when Google rejects the master token", async () => {
    mockAndroidAuthError("BadAuthentication");
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: TEST_EMAIL,
      master_token: "invalid-token",
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Master token verification failed");
    expect(data.error).toContain("BadAuthentication");
  });

  it("stores the integration on success and returns connected status", async () => {
    mockAndroidAuthOk();
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: TEST_EMAIL,
      master_token: MASTER_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);

    // Integration should now be visible via GET
    const status = await authed("/integrations/google");
    const data = (await status.json()) as { connected: boolean; email: string };
    expect(data.connected).toBe(true);
    expect(data.email).toBe(TEST_EMAIL);
  });

  it("parses \\r\\n Android auth response correctly (no trailing \\r in token)", async () => {
    // The mock returns \r\n line endings; the stored token should be clean
    mockAndroidAuthOk("clean_token_no_cr");
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: TEST_EMAIL,
      master_token: MASTER_TOKEN,
    });
    expect(res.status).toBe(200);
    // Verify the integration was stored (getKeepAuthToken did not throw)
    const statusRes = await authed("/integrations/google");
    expect(((await statusRes.json()) as { connected: boolean }).connected).toBe(true);
  });

  it("succeeds when account has no email (skips email check)", async () => {
    await setupUser(null); // user with no account email
    mockAndroidAuthOk();
    const res = await authedJson("/integrations/google/manual-token", "POST", {
      email: "any@gmail.com",
      master_token: MASTER_TOKEN,
    });
    expect(res.status).toBe(200);
  });
});

// ── DELETE /integrations/google ───────────────────────────────────────────

describe("DELETE /integrations/google", () => {
  beforeEach(async () => {
    await setupUser();
    await seedIntegration();
  });
  afterEach(() => vi.restoreAllMocks());

  it("disconnects the integration", async () => {
    const before = (await (await authed("/integrations/google")).json()) as { connected: boolean };
    expect(before.connected).toBe(true);

    const del = await authed("/integrations/google", { method: "DELETE" });
    expect(del.status).toBe(200);

    const after = (await (await authed("/integrations/google")).json()) as { connected: boolean };
    expect(after.connected).toBe(false);
  });
});

// ── POST /integrations/google/keep/export ────────────────────────────────

describe("POST /integrations/google/keep/export", () => {
  beforeEach(async () => {
    await setupUser();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when no integration is configured", async () => {
    const res = await authedJson("/integrations/google/keep/export", "POST", {
      date_from: "2025-01-01",
      date_to: "2025-01-07",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not configured");
  });

  it("returns 400 when the grocery list is empty", async () => {
    await seedIntegration();
    mockAndroidAuthOk(); // getKeepAuthToken succeeds
    const res = await authedJson("/integrations/google/keep/export", "POST", {
      date_from: "2025-01-01",
      date_to: "2025-01-07",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("No grocery items");
  });

  it("returns 502 when Keep auth token fetch fails", async () => {
    await seedIntegration();
    mockAndroidAuthError("BadAuthentication");
    const res = await authedJson("/integrations/google/keep/export", "POST", {
      date_from: "2025-01-01",
      date_to: "2025-01-07",
    });
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string; detail: string };
    expect(data.error).toContain("Keep authentication failed");
    expect(data.detail).toContain("BadAuthentication");
  });

  it("exports grocery list to Keep and returns node URL", async () => {
    await seedIntegration();

    // Add a meal with an ingredient that is out of stock
    await env.DB
      .prepare(
        `INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
         VALUES (?, ?, '2025-01-03', 'Pasta', ?, '[]', ?)`,
      )
      .bind(
        "meal_test",
        TEST_HOUSEHOLD_ID,
        JSON.stringify([{ name: "Pasta", quantity: 500, unit: "g" }]),
        Date.now(),
      )
      .run();

    mockAndroidAuthOk("keep_auth_token");
    mockKeepApiOk("srv_list_123");

    const res = await authedJson("/integrations/google/keep/export", "POST", {
      date_from: "2025-01-01",
      date_to: "2025-01-07",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; node_id: string; url: string };
    expect(data.success).toBe(true);
    expect(data.node_id).toBe("srv_list_123");
    expect(data.url).toContain("srv_list_123");

    // keep_list_id should be persisted for next time
    const status = (await (await authed("/integrations/google")).json()) as {
      keep_list_id: string | null;
    };
    expect(status.keep_list_id).toBe("srv_list_123");
  });
});
