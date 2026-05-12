import type { Env } from "../types.ts";
import { signJwt, verifyPkce, hashToken, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, type JwtPayload } from "./jwt.ts";
import {
  getUser,
  getUserByEmail,
  updateUserEmail,
  getIdentity,
  linkIdentity,
  createUserWithIdentity,
} from "../db/queries.ts";
import {
  getOAuthClient,
  insertOAuthClient,
  insertOAuthState,
  getAndDeleteOAuthState,
  insertOAuthCode,
  claimOAuthCode,
  insertRefreshToken,
  claimRefreshToken,
  type OAuthCodeRow,
} from "../db/oauth.ts";

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
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

function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string") return false;
  try {
    const parsed = new URL(uri);
    return parsed.hash === ""; // fragments not allowed
  } catch {
    return false;
  }
}

// GET /.well-known/oauth-protected-resource (RFC 9728)
// Claude uses this to confirm the authorization server URL before starting auth.
export function handleProtectedResource(request: Request): Response {
  const issuer = issuerFromRequest(request);
  return jsonResponse({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
  });
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
    token_endpoint_auth_methods_supported: ["none"],
  });
}

// POST /register — Dynamic Client Registration (RFC 7591)
// Claude.ai is a public client using PKCE; no client_secret is issued.
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
  if (!redirectUris.every(isValidRedirectUri)) {
    return oauthError(
      "invalid_redirect_uri",
      "Each redirect_uri must be a valid URL without a fragment",
    );
  }

  const clientId = crypto.randomUUID();
  const now = Date.now();
  await insertOAuthClient(env.DB, clientId, redirectUris as string[], now);

  return jsonResponse(
    {
      client_id: clientId,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

// GET /authorize
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) {
    return new Response("Server misconfiguration: GITHUB_CLIENT_ID not set", { status: 500 });
  }

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

  const client = await getOAuthClient(env.DB, clientId);
  if (!client) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }

  let allowedUris: string[];
  try {
    allowedUris = JSON.parse(client.redirect_uris) as string[];
  } catch {
    return oauthError("server_error", "Stored client configuration is invalid", 500);
  }
  if (!allowedUris.includes(redirectUri)) {
    return oauthError("invalid_redirect_uri", "redirect_uri not registered for this client");
  }

  const internalState = crypto.randomUUID();
  await insertOAuthState(env.DB, {
    state: internalState,
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    redirect_uri: redirectUri,
    original_state: state,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 min in ms
  });

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", `${issuerFromRequest(request)}/oauth/callback`);
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

  const pending = await getAndDeleteOAuthState(env.DB, state);
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

  // Fetch verified emails — /user/emails is more reliable than the profile email field
  const emailsRes = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "grocery-store-mcp/1.0",
    },
  });
  let verifiedEmail: string | null = null;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);
    verifiedEmail = primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
  }

  const provider = "github";
  const providerId = String(ghUser.id);

  const identity = await getIdentity(env.DB, provider, providerId);
  let userId: string;

  if (identity) {
    userId = identity.user_id;
    // Back-fill email if the user record doesn't have one yet
    if (verifiedEmail) {
      const user = await getUser(env.DB, userId);
      if (user && !user.email) {
        await updateUserEmail(env.DB, userId, verifiedEmail);
      }
    }
  } else if (verifiedEmail) {
    // No identity yet — check if a user already owns this verified email
    const emailOwner = await getUserByEmail(env.DB, verifiedEmail);
    if (emailOwner) {
      // Link this provider identity to the existing account
      userId = emailOwner.id;
      await linkIdentity(env.DB, provider, providerId, userId);
    } else {
      userId = await createUserWithIdentity(env.DB, provider, providerId, verifiedEmail);
    }
  } else {
    userId = await createUserWithIdentity(env.DB, provider, providerId, null);
  }

  // Issue MCP auth code
  const authCode = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await insertOAuthCode(env.DB, {
    code: authCode,
    client_id: pending.client_id,
    user_id: userId,
    code_challenge: pending.code_challenge,
    code_challenge_method: pending.code_challenge_method,
    redirect_uri: pending.redirect_uri,
    expires_at: Date.now() + 5 * 60 * 1000, // 5 min in ms
    used: 0,
  });

  const callbackUrl = new URL(pending.redirect_uri);
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
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    return new Response("Server misconfiguration: JWT_SECRET too short", { status: 500 });
  }

  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");
  const clientId = params.get("client_id");

  if (!code || !redirectUri || !codeVerifier || !clientId) {
    return oauthError("invalid_request", "Missing required parameters");
  }

  // Verify client exists
  const client = await getOAuthClient(env.DB, clientId);
  if (!client) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }

  // Atomically claim the auth code — prevents double-redemption
  const authCode = await claimOAuthCode(env.DB, code, Date.now());
  if (!authCode) {
    return oauthError("invalid_grant", "Authorization code is invalid, expired, or already used");
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

  return issueTokens(request, env, authCode.user_id, clientId);
}

async function handleRefreshGrant(
  request: Request,
  params: URLSearchParams,
  env: Env,
): Promise<Response> {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    return new Response("Server misconfiguration: JWT_SECRET too short", { status: 500 });
  }

  const refreshToken = params.get("refresh_token");
  const clientId = params.get("client_id");

  if (!refreshToken || !clientId) {
    return oauthError("invalid_request", "Missing required parameters");
  }

  // Verify client exists
  const client = await getOAuthClient(env.DB, clientId);
  if (!client) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }

  const tokenHash = await hashToken(refreshToken);

  // Atomically revoke the old token — prevents concurrent rotation races
  const stored = await claimRefreshToken(env.DB, tokenHash, Date.now());
  if (!stored) {
    return oauthError("invalid_grant", "Refresh token is invalid, expired, or already used");
  }
  if (stored.client_id !== clientId) {
    return oauthError("invalid_grant", "client_id mismatch");
  }

  return issueTokens(request, env, stored.user_id, clientId);
}

async function issueTokens(
  request: Request,
  env: Env,
  userId: string,
  clientId: string,
): Promise<Response> {
  const { payload, ttl } = makeAccessPayload(userId, issuerFromRequest(request));
  const accessToken = await signJwt(payload, env.JWT_SECRET);

  const refreshToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const refreshHash = await hashToken(refreshToken);

  await insertRefreshToken(env.DB, {
    token_hash: refreshHash,
    user_id: userId,
    client_id: clientId,
    expires_at: Date.now() + REFRESH_TOKEN_TTL * 1000, // convert seconds to ms
    revoked: 0,
  });

  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttl,
    refresh_token: refreshToken,
  });
}

function makeAccessPayload(userId: string, issuer: string): { payload: JwtPayload; ttl: number } {
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
