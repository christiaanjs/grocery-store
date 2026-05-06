import type { Env } from "../types.ts";
import {
  signJwt,
  verifyPkce,
  hashToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  type JwtPayload,
} from "./jwt.ts";
import { getUser, createUserWithHousehold } from "../db/queries.ts";

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
}

interface OAuthStateRow {
  state: string;
  client_id: string;
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri: string;
  original_state: string | null;
  expires_at: number;
}

interface OAuthCodeRow {
  code: string;
  client_id: string;
  user_id: string;
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri: string;
  expires_at: number;
  used: number;
}

interface OAuthRefreshTokenRow {
  token_hash: string;
  user_id: string;
  client_id: string;
  expires_at: number;
  revoked: number;
}

function issuerFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, status);
}

// GET /.well-known/oauth-authorization-server
export function handleMetadata(request: Request): Response {
  const issuer = issuerFromRequest(request);
  return jsonResponse({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
  });
}

// POST /register — Dynamic Client Registration (RFC 7591)
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_request", "Invalid JSON body");
  }

  const redirectUris = body["redirect_uris"];
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return oauthError("invalid_redirect_uri", "redirect_uris is required and must be non-empty");
  }

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const secretHash = await hashToken(clientSecret);
  const now = Date.now();

  await env.DB.prepare(
    "INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(clientId, secretHash, JSON.stringify(redirectUris), now)
    .run();

  return jsonResponse(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
    201,
  );
}

// GET /authorize
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");

  if (responseType !== "code") {
    return oauthError("unsupported_response_type", "Only code response_type is supported");
  }
  if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
    return oauthError("invalid_request", "Missing required parameters");
  }
  if (codeChallengeMethod !== "S256") {
    return oauthError("invalid_request", "Only S256 code_challenge_method is supported");
  }

  const client = await env.DB.prepare(
    "SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?",
  )
    .bind(clientId)
    .first<{ client_id: string; redirect_uris: string }>();

  if (!client) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }
  const allowedUris = JSON.parse(client.redirect_uris) as string[];
  if (!allowedUris.includes(redirectUri)) {
    return oauthError("invalid_redirect_uri", "redirect_uri not registered for this client");
  }

  const internalState = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min

  await env.DB.prepare(
    "INSERT INTO oauth_states (state, client_id, code_challenge, code_challenge_method, redirect_uri, original_state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(internalState, clientId, codeChallenge, codeChallengeMethod, redirectUri, state, expiresAt)
    .run();

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set(
    "redirect_uri",
    `${issuerFromRequest(request)}/oauth/callback`,
  );
  githubUrl.searchParams.set("scope", "user:email");
  githubUrl.searchParams.set("state", internalState);

  return Response.redirect(githubUrl.toString(), 302);
}

// GET /oauth/callback
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const pending = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?")
    .bind(state)
    .first<OAuthStateRow>();

  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();

  if (!pending || pending.expires_at < Date.now()) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  // Exchange GitHub code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${issuerFromRequest(request)}/oauth/callback`,
    }),
  });

  if (!tokenRes.ok) {
    return new Response("GitHub token exchange failed", { status: 502 });
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return new Response(`GitHub auth error: ${tokenData.error ?? "unknown"}`, { status: 502 });
  }

  // Fetch GitHub user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "grocery-store-mcp/1.0",
    },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch GitHub user", { status: 502 });
  }

  const ghUser = (await userRes.json()) as GitHubUser;
  const userId = `github:${ghUser.id}`;

  const existing = await getUser(env.DB, userId);
  if (!existing) {
    await createUserWithHousehold(env.DB, userId, ghUser.email);
  }

  // Issue MCP auth code
  const authCode = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const codeExpiresAt = Date.now() + 5 * 60 * 1000; // 5 min

  await env.DB.prepare(
    "INSERT INTO oauth_codes (code, client_id, user_id, code_challenge, code_challenge_method, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      authCode,
      pending.client_id,
      userId,
      pending.code_challenge,
      pending.code_challenge_method,
      pending.redirect_uri,
      codeExpiresAt,
    )
    .run();

  const callbackUrl = new URL("https://claude.ai/api/mcp/auth_callback");
  callbackUrl.searchParams.set("code", authCode);
  if (pending.original_state) callbackUrl.searchParams.set("state", pending.original_state);

  return Response.redirect(callbackUrl.toString(), 302);
}

// POST /token
export async function handleToken(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded");
  }

  const params = new URLSearchParams(await request.text());
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    return handleAuthCodeGrant(request, params, env);
  }
  if (grantType === "refresh_token") {
    return handleRefreshGrant(request, params, env);
  }
  return oauthError(
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported",
  );
}

async function handleAuthCodeGrant(
  request: Request,
  params: URLSearchParams,
  env: Env,
): Promise<Response> {
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");
  const clientId = params.get("client_id") ?? extractClientIdFromAuth(request);

  if (!code || !redirectUri || !codeVerifier || !clientId) {
    return oauthError("invalid_request", "Missing required parameters");
  }

  const authCode = await env.DB.prepare("SELECT * FROM oauth_codes WHERE code = ?")
    .bind(code)
    .first<OAuthCodeRow>();

  if (!authCode || authCode.used || authCode.expires_at < Date.now()) {
    return oauthError("invalid_grant", "Authorization code is invalid or expired");
  }
  if (authCode.client_id !== clientId) {
    return oauthError("invalid_grant", "client_id mismatch");
  }
  if (authCode.redirect_uri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri mismatch");
  }

  const pkceValid = await verifyPkce(
    codeVerifier,
    authCode.code_challenge,
    authCode.code_challenge_method,
  );
  if (!pkceValid) {
    return oauthError("invalid_grant", "PKCE verification failed");
  }

  await env.DB.prepare("UPDATE oauth_codes SET used = 1 WHERE code = ?").bind(code).run();

  const { payload, ttl } = makeAccessPayload(authCode.user_id, issuerFromRequest(request));
  const accessToken = await signJwt(payload, env.JWT_SECRET);

  const refreshToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const refreshHash = await hashToken(refreshToken);
  const refreshExpiresAt = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL;

  await env.DB.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(refreshHash, authCode.user_id, clientId, refreshExpiresAt)
    .run();

  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttl,
    refresh_token: refreshToken,
  });
}

async function handleRefreshGrant(
  request: Request,
  params: URLSearchParams,
  env: Env,
): Promise<Response> {
  const refreshToken = params.get("refresh_token");
  const clientId = params.get("client_id") ?? extractClientIdFromAuth(request);

  if (!refreshToken || !clientId) {
    return oauthError("invalid_request", "Missing required parameters");
  }

  const tokenHash = await hashToken(refreshToken);
  const stored = await env.DB.prepare(
    "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<OAuthRefreshTokenRow>();

  if (!stored || stored.revoked || stored.expires_at < Math.floor(Date.now() / 1000)) {
    return oauthError("invalid_grant", "Refresh token is invalid or expired");
  }
  if (stored.client_id !== clientId) {
    return oauthError("invalid_grant", "client_id mismatch");
  }

  // Rotate refresh token
  await env.DB.prepare(
    "UPDATE oauth_refresh_tokens SET revoked = 1 WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .run();

  const newRefreshToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const newRefreshHash = await hashToken(newRefreshToken);
  const newRefreshExpiresAt = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL;

  await env.DB.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, user_id, client_id, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(newRefreshHash, stored.user_id, clientId, newRefreshExpiresAt)
    .run();

  const { payload, ttl } = makeAccessPayload(stored.user_id, issuerFromRequest(request));
  const accessToken = await signJwt(payload, env.JWT_SECRET);

  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttl,
    refresh_token: newRefreshToken,
  });
}

function makeAccessPayload(
  userId: string,
  issuer: string,
): { payload: JwtPayload; ttl: number } {
  const now = Math.floor(Date.now() / 1000);
  return {
    payload: {
      sub: userId,
      iss: issuer,
      aud: "mcp",
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
      jti: crypto.randomUUID(),
    },
    ttl: ACCESS_TOKEN_TTL,
  };
}

function extractClientIdFromAuth(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(auth.slice(6));
    const colonIdx = decoded.indexOf(":");
    return colonIdx > 0 ? decoded.slice(0, colonIdx) : null;
  } catch {
    return null;
  }
}
