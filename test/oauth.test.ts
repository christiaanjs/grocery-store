import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../src/auth/jwt.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

const TEST_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

async function base64urlEncode(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function computeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(hash);
}

async function register(redirectUri = TEST_REDIRECT_URI): Promise<{ clientId: string }> {
  const res = await SELF.fetch("http://localhost/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri] }),
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { client_id: string };
  return { clientId: data.client_id };
}

async function insertAuthCode(opts: {
  clientId: string;
  userId: string;
  codeChallenge: string;
  redirectUri?: string;
  expiresAt?: number;
}): Promise<string> {
  const code = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO oauth_codes (code, client_id, user_id, code_challenge, code_challenge_method, redirect_uri, expires_at) VALUES (?, ?, ?, ?, 'S256', ?, ?)",
  )
    .bind(
      code,
      opts.clientId,
      opts.userId,
      opts.codeChallenge,
      opts.redirectUri ?? TEST_REDIRECT_URI,
      opts.expiresAt ?? Date.now() + 60_000,
    )
    .run();
  return code;
}

async function insertRefreshToken(opts: {
  tokenHash: string;
  userId: string;
  clientId: string;
  expiresAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(
      opts.tokenHash,
      opts.userId,
      opts.clientId,
      opts.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    )
    .run();
}

async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function tokenRequest(params: Record<string, string>): Promise<Response> {
  return SELF.fetch("http://localhost/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

// ── JWT helpers ───────────────────────────────────────────────────────────

describe("verifyJwt", () => {
  it("returns payload for a valid token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: "usr_1", iss: "http://localhost", aud: "mcp", iat: now, exp: now + 3600, jti: "j1" };
    const token = await signJwt(payload, env.JWT_SECRET);
    const result = await verifyJwt(token, env.JWT_SECRET);
    expect(result?.sub).toBe("usr_1");
    expect(result?.aud).toBe("mcp");
  });

  it("returns null for an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: "usr_1", iss: "http://localhost", aud: "mcp", iat: now - 7200, exp: now - 3600, jti: "j2" };
    const token = await signJwt(payload, env.JWT_SECRET);
    expect(await verifyJwt(token, env.JWT_SECRET)).toBeNull();
  });

  it("returns null for a token with wrong signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: "usr_1", iss: "http://localhost", aud: "mcp", iat: now, exp: now + 3600, jti: "j3" };
    const token = await signJwt(payload, env.JWT_SECRET);
    const tampered = token.slice(0, -4) + "xxxx";
    expect(await verifyJwt(tampered, env.JWT_SECRET)).toBeNull();
  });

  it("returns null for a token with wrong aud", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: "usr_1", iss: "http://localhost", aud: "other", iat: now, exp: now + 3600, jti: "j4" };
    const token = await signJwt(payload, env.JWT_SECRET);
    expect(await verifyJwt(token, env.JWT_SECRET)).toBeNull();
  });

  it("returns null for malformed base64url input", async () => {
    expect(await verifyJwt("not.a.jwt!!!", env.JWT_SECRET)).toBeNull();
  });

  it("returns null for a token missing exp", async () => {
    // Manually craft a token without exp
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
    const body = btoa(JSON.stringify({ sub: "usr_1", aud: "mcp" })).replace(/=/g, "");
    const fakeToken = `${header}.${body}.invalidsig`;
    expect(await verifyJwt(fakeToken, env.JWT_SECRET)).toBeNull();
  });
});

// ── Metadata ──────────────────────────────────────────────────────────────

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns metadata when ENABLE_OAUTH=true", async () => {
    const res = await SELF.fetch("http://localhost/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["issuer"]).toBe("http://localhost");
    expect(data["authorization_endpoint"]).toBe("http://localhost/authorize");
    expect(data["token_endpoint"]).toBe("http://localhost/token");
    expect(data["registration_endpoint"]).toBe("http://localhost/register");
    expect(data["code_challenge_methods_supported"]).toContain("S256");
    expect(data["token_endpoint_auth_methods_supported"]).toContain("none");
  });
});

// ── Registration ──────────────────────────────────────────────────────────

describe("POST /register", () => {
  it("creates a client and returns client_id", async () => {
    const res = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [TEST_REDIRECT_URI] }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data["client_id"]).toBe("string");
    expect(data["redirect_uris"]).toEqual([TEST_REDIRECT_URI]);
    expect(data["token_endpoint_auth_method"]).toBe("none");
    expect(data["client_secret"]).toBeUndefined();
  });

  it("rejects missing redirect_uris", async () => {
    const res = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_redirect_uri");
  });

  it("rejects empty redirect_uris array", async () => {
    const res = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-string redirect_uri entries", async () => {
    const res = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [123, null] }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_redirect_uri");
  });

  it("rejects redirect_uri with fragment", async () => {
    const res = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://example.com/cb#fragment"] }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Authorization endpoint ────────────────────────────────────────────────

describe("GET /authorize", () => {
  it("rejects unknown client_id", async () => {
    const res = await SELF.fetch(
      "http://localhost/authorize?response_type=code&client_id=unknown&redirect_uri=https%3A%2F%2Fexample.com&code_challenge=abc&code_challenge_method=S256",
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_client");
  });

  it("rejects mismatched redirect_uri", async () => {
    const { clientId } = await register();
    const res = await SELF.fetch(
      `http://localhost/authorize?response_type=code&client_id=${clientId}&redirect_uri=https%3A%2F%2Fother.example.com&code_challenge=abc&code_challenge_method=S256`,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_redirect_uri");
  });

  it("rejects non-S256 code_challenge_method", async () => {
    const { clientId } = await register();
    const uri = encodeURIComponent(TEST_REDIRECT_URI);
    const res = await SELF.fetch(
      `http://localhost/authorize?response_type=code&client_id=${clientId}&redirect_uri=${uri}&code_challenge=abc&code_challenge_method=plain`,
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_request");
  });

  it("redirects to GitHub with valid params", async () => {
    const { clientId } = await register();
    const uri = encodeURIComponent(TEST_REDIRECT_URI);
    const res = await SELF.fetch(
      `http://localhost/authorize?response_type=code&client_id=${clientId}&redirect_uri=${uri}&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("github.com/login/oauth/authorize");
    expect(location).toContain("client_id=test-github-client-id");
  });
});

// ── Token endpoint — authorization_code grant ─────────────────────────────

describe("POST /token (authorization_code)", () => {
  it("issues tokens for a valid code + verifier", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({ clientId, userId: "usr_test", codeChallenge: challenge });

    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data["access_token"]).toBe("string");
    expect(data["token_type"]).toBe("Bearer");
    expect(typeof data["refresh_token"]).toBe("string");
    expect(typeof data["expires_in"]).toBe("number");
  });

  it("access token is a valid JWT with correct claims", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789a";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({ clientId, userId: "usr_jwt_test", codeChallenge: challenge });

    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
    });
    const { access_token } = (await res.json()) as { access_token: string };
    const payload = await verifyJwt(access_token, env.JWT_SECRET);
    expect(payload?.sub).toBe("usr_jwt_test");
    expect(payload?.aud).toBe("mcp");
  });

  it("rejects an unknown authorization code", async () => {
    const { clientId } = await register();
    const res = await tokenRequest({
      grant_type: "authorization_code",
      code: "not-a-real-code",
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: "anyverifier",
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects an expired authorization code", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789b";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({
      clientId,
      userId: "usr_test",
      codeChallenge: challenge,
      expiresAt: Date.now() - 1000, // already expired
    });

    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects a code with wrong PKCE verifier", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789c";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({ clientId, userId: "usr_test", codeChallenge: challenge });

    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: "wrong-verifier-abcdefghijklmnopqrstuvwxyz0123456",
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects a code used twice (atomicity)", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789d";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({ clientId, userId: "usr_test", codeChallenge: challenge });

    const params = {
      grant_type: "authorization_code",
      code,
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: verifier,
      client_id: clientId,
    };

    const res1 = await tokenRequest(params);
    expect(res1.status).toBe(200);

    const res2 = await tokenRequest(params);
    expect(res2.status).toBe(400);
    const data = (await res2.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects wrong redirect_uri", async () => {
    const { clientId } = await register();
    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz0123456789e";
    const challenge = await computeChallenge(verifier);
    const code = await insertAuthCode({ clientId, userId: "usr_test", codeChallenge: challenge });

    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://evil.example.com/callback",
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects unknown client_id", async () => {
    const res = await tokenRequest({
      grant_type: "authorization_code",
      code: "somecode",
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: "someverifier",
      client_id: "unknown-client",
    });
    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_client");
  });
});

// ── Token endpoint — refresh_token grant ─────────────────────────────────

describe("POST /token (refresh_token)", () => {
  it("issues new tokens for a valid refresh token", async () => {
    const { clientId } = await register();
    const refreshToken = crypto.randomUUID();
    const tokenHash = await hashToken(refreshToken);
    await insertRefreshToken({ tokenHash, userId: "usr_test", clientId });

    const res = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data["access_token"]).toBe("string");
    expect(typeof data["refresh_token"]).toBe("string");
    expect(data["refresh_token"]).not.toBe(refreshToken); // token was rotated
  });

  it("rejects a refresh token used twice (rotation atomicity)", async () => {
    const { clientId } = await register();
    const refreshToken = crypto.randomUUID();
    const tokenHash = await hashToken(refreshToken);
    await insertRefreshToken({ tokenHash, userId: "usr_test", clientId });

    const res1 = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(res1.status).toBe(200);

    const res2 = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(res2.status).toBe(400);
    const data = (await res2.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects an unknown refresh token", async () => {
    const { clientId } = await register();
    const res = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: "not-a-real-token",
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });

  it("rejects an expired refresh token", async () => {
    const { clientId } = await register();
    const refreshToken = crypto.randomUUID();
    const tokenHash = await hashToken(refreshToken);
    await insertRefreshToken({
      tokenHash,
      userId: "usr_test",
      clientId,
      expiresAt: Date.now() - 1000,
    });

    const res = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("invalid_grant");
  });
});

// ── Authentication middleware ─────────────────────────────────────────────

describe("authenticate (via /mcp)", () => {
  it("accepts a valid Bearer JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "usr_test",
      iss: "http://localhost",
      aud: "mcp",
      iat: now,
      exp: now + 3600,
      jti: crypto.randomUUID(),
    };
    const token = await signJwt(payload, env.JWT_SECRET);

    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects an expired Bearer JWT with 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "usr_test",
      iss: "http://localhost",
      aud: "mcp",
      iat: now - 7200,
      exp: now - 3600,
      jti: crypto.randomUUID(),
    };
    const token = await signJwt(payload, env.JWT_SECRET);

    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed Bearer token without throwing", async () => {
    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not!!valid!!jwt" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });
});
