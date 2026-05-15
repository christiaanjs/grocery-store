import type { Env } from "../types.ts";
import { authenticate } from "../auth/middleware.ts";
import { getUser } from "../db/queries.ts";
import { getMealEntries, listPantryItems } from "../db/queries.ts";
import {
  getIntegration,
  upsertIntegration,
  deleteIntegration,
  updateIntegrationKeepList,
  insertIntegrationAuthState,
  getAndDeleteIntegrationAuthState,
} from "../db/integrations.ts";
import { encryptToken, decryptToken } from "../crypto.ts";
import { exchangeToken, getKeepAuthToken } from "../google/gpsoauth.ts";
import { createGroceryList } from "../google/gkeepapi.ts";
import { buildGroceryList } from "../mcp/tools/grocery.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Derive a stable 16-character hex Android device ID from a user UUID.
function androidIdFromUserId(userId: string): string {
  return userId.replace(/-/g, "").slice(0, 16);
}

// GET /integrations/google
export async function handleGetIntegrationStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const user = await getUser(env.DB, auth.userId);
  if (!user) return new Response("User not found", { status: 404 });
  const integration = await getIntegration(env.DB, user.household_id, "google");
  if (!integration) return json({ connected: false });
  return json({
    connected: true,
    email: integration.google_email,
    keep_list_id: integration.keep_list_id,
  });
}

// POST /integrations/google/authorize
// Returns a redirect URL for the Google OAuth flow.
export async function handleGoogleAuthorize(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response("Google OAuth is not configured", { status: 500 });
  }
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });

  const state = crypto.randomUUID();
  await insertIntegrationAuthState(env.DB, state, auth.userId, Date.now() + 10 * 60 * 1000);

  const issuer = new URL(request.url).origin;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${issuer}/integrations/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return json({ redirect_url: url.toString() });
}

// GET /integrations/google/callback
export async function handleGoogleCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const frontendBase = env.ALLOWED_ORIGIN;

  if (errorParam) {
    return Response.redirect(
      `${frontendBase}/integrations?error=${encodeURIComponent(errorParam)}`,
      302,
    );
  }
  if (!code || !state) {
    return Response.redirect(`${frontendBase}/integrations?error=missing_params`, 302);
  }

  const stateData = await getAndDeleteIntegrationAuthState(env.DB, state);
  if (!stateData || stateData.expires_at < Date.now()) {
    return Response.redirect(`${frontendBase}/integrations?error=invalid_state`, 302);
  }

  const user = await getUser(env.DB, stateData.user_id);
  if (!user) {
    return Response.redirect(`${frontendBase}/integrations?error=user_not_found`, 302);
  }

  // Exchange code for Google access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/integrations/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("[integrations] OAuth token exchange failed:", tokenRes.status, await tokenRes.text().catch(() => ""));
    return Response.redirect(`${frontendBase}/integrations?error=token_exchange_failed`, 302);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    console.error("[integrations] No access_token in OAuth response:", tokenData);
    return Response.redirect(`${frontendBase}/integrations?error=no_access_token`, 302);
  }

  // Fetch Google account email
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userInfoRes.ok) {
    console.error("[integrations] userinfo fetch failed:", userInfoRes.status);
    return Response.redirect(`${frontendBase}/integrations?error=userinfo_failed`, 302);
  }
  const userInfo = (await userInfoRes.json()) as { email: string; email_verified: boolean };
  if (!userInfo.email_verified) {
    return Response.redirect(`${frontendBase}/integrations?error=email_not_verified`, 302);
  }
  const googleEmail = userInfo.email.toLowerCase();

  // Verify the Google account email matches the user's account email
  if (user.email && user.email.toLowerCase() !== googleEmail) {
    console.error("[integrations] email mismatch: account=%s google=%s", user.email, googleEmail);
    return Response.redirect(
      `${frontendBase}/integrations?error=email_mismatch&google_email=${encodeURIComponent(googleEmail)}`,
      302,
    );
  }

  // Exchange OAuth access token for a Google master token via Android auth endpoint
  const androidId = androidIdFromUserId(user.id);
  let masterToken: string;
  try {
    const result = await exchangeToken(googleEmail, tokenData.access_token, androidId);
    if (!result["Token"]) {
      const errMsg = result["Error"] ?? "no_token";
      console.error("[integrations] exchangeToken returned no Token. Error=%s Info=%s", result["Error"], result["Info"]);
      return Response.redirect(
        `${frontendBase}/integrations?error=master_token_error&detail=${encodeURIComponent(errMsg)}&google_email=${encodeURIComponent(googleEmail)}`,
        302,
      );
    }
    masterToken = result["Token"];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[integrations] exchangeToken threw:", msg);
    return Response.redirect(
      `${frontendBase}/integrations?error=master_token_failed&detail=${encodeURIComponent(msg)}&google_email=${encodeURIComponent(googleEmail)}`,
      302,
    );
  }

  if (!env.INTEGRATION_SECRET) {
    console.error("[integrations] INTEGRATION_SECRET is not configured");
    return Response.redirect(`${frontendBase}/integrations?error=not_configured`, 302);
  }

  const { ciphertext, iv } = await encryptToken(env.INTEGRATION_SECRET, masterToken);
  await upsertIntegration(env.DB, user.household_id, "google", ciphertext, iv, googleEmail);

  return Response.redirect(`${frontendBase}/integrations?connected=true`, 302);
}

// DELETE /integrations/google
export async function handleDeleteIntegration(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const user = await getUser(env.DB, auth.userId);
  if (!user) return new Response("User not found", { status: 404 });
  await deleteIntegration(env.DB, user.household_id, "google");
  return json({ success: true });
}

// PUT /integrations/google
export async function handleUpdateIntegration(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const user = await getUser(env.DB, auth.userId);
  if (!user) return new Response("User not found", { status: 404 });
  const body = (await request.json()) as { keep_list_id?: string | null };
  await updateIntegrationKeepList(env.DB, user.household_id, "google", body.keep_list_id ?? null);
  return json({ success: true });
}

// POST /integrations/google/manual-token
// Alternative flow: user provides email + master token obtained from EmbeddedSetup.
export async function handleManualToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  if (!env.INTEGRATION_SECRET) {
    console.error("[integrations] INTEGRATION_SECRET is not configured");
    return json({ error: "Integration secret not configured" }, 500);
  }

  const user = await getUser(env.DB, auth.userId);
  if (!user) return new Response("User not found", { status: 404 });

  const body = (await request.json()) as { email?: string; master_token?: string };
  if (!body.email || !body.master_token) {
    return json({ error: "email and master_token are required" }, 400);
  }

  const googleEmail = body.email.toLowerCase().trim();

  if (user.email && user.email.toLowerCase() !== googleEmail) {
    console.error("[integrations] manual-token email mismatch: account=%s provided=%s", user.email, googleEmail);
    return json({ error: "The Google account email does not match your account email" }, 400);
  }

  // Verify the master token works by attempting to get a Keep auth token.
  // This catches typos and expired tokens before we store them.
  const androidId = androidIdFromUserId(user.id);
  try {
    await getKeepAuthToken(googleEmail, body.master_token, androidId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[integrations] manual-token: getKeepAuthToken failed for %s: %s", googleEmail, msg);
    return json({ error: `Master token verification failed: ${msg}` }, 400);
  }

  const { ciphertext, iv } = await encryptToken(env.INTEGRATION_SECRET, body.master_token);
  await upsertIntegration(env.DB, user.household_id, "google", ciphertext, iv, googleEmail);
  return json({ success: true });
}

// POST /integrations/google/keep/export
export async function handleExportToKeep(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  if (!env.INTEGRATION_SECRET) {
    console.error("[integrations] INTEGRATION_SECRET is not configured");
    return json({ error: "Integration secret not configured" }, 500);
  }

  const user = await getUser(env.DB, auth.userId);
  if (!user) return new Response("User not found", { status: 404 });

  const integration = await getIntegration(env.DB, user.household_id, "google");
  if (!integration) {
    return json({ error: "Google Keep integration not configured" }, 400);
  }

  let masterToken: string;
  try {
    masterToken = await decryptToken(
      env.INTEGRATION_SECRET,
      integration.encrypted_token,
      integration.token_iv,
    );
  } catch (err) {
    console.error("[integrations] failed to decrypt master token:", err);
    return json({ error: "Failed to decrypt credentials" }, 500);
  }

  const androidId = androidIdFromUserId(user.id);
  let keepAuthToken: string;
  try {
    keepAuthToken = await getKeepAuthToken(
      integration.google_email ?? "",
      masterToken,
      androidId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[integrations] getKeepAuthToken failed during export for %s: %s", integration.google_email, msg);
    return json({ error: "Keep authentication failed", detail: msg }, 502);
  }

  const body = (await request.json()) as { date_from: string; date_to: string; title?: string };

  const [meals, pantry] = await Promise.all([
    getMealEntries(env.DB, user.household_id, body.date_from, body.date_to),
    listPantryItems(env.DB, user.household_id),
  ]);

  const items = buildGroceryList(meals, pantry);
  if (items.length === 0) {
    return json({ error: "No grocery items to export" }, 400);
  }

  const title = body.title ?? `Grocery List (${body.date_from} – ${body.date_to})`;

  try {
    const result = await createGroceryList(keepAuthToken, title, items);
    await updateIntegrationKeepList(env.DB, user.household_id, "google", result.nodeId);
    return json({ success: true, node_id: result.nodeId, url: result.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[integrations] createGroceryList failed:", msg);
    return json({ error: "Failed to create Keep note", detail: msg }, 502);
  }
}
