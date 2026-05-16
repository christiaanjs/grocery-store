import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.ts";
import { authenticate } from "./auth/middleware.ts";
import { handleMcp } from "./mcp/server.ts";
import {
  handleProtectedResource,
  handleMetadata,
  handleRegister,
  handleAuthorize,
  handleCallback,
  handleToken,
} from "./auth/oauth.ts";
import {
  handleGetIntegrationStatus,
  handleGoogleAuthorize,
  handleGoogleCallback,
  handleDeleteIntegration,
  handleUpdateIntegration,
  handleExchangeOAuthToken,
  handleManualToken,
  handleExportToKeep,
} from "./routes/integrations.ts";

function isAllowedOrigin(origin: string, allowedOrigin: string, allowSubdomains: boolean): boolean {
  if (!allowedOrigin || !origin) return false;
  if (origin === allowedOrigin) return true;
  if (!allowSubdomains) return false;
  try {
    const allowed = new URL(allowedOrigin);
    const incoming = new URL(origin);
    return incoming.protocol === allowed.protocol &&
      incoming.hostname.endsWith("." + allowed.hostname);
  } catch {
    return false;
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", (c, next) => {
  const env = c.env;
  return cors({
    origin: (origin) =>
      isAllowedOrigin(origin, env.ALLOWED_ORIGIN, env.ALLOW_ORIGIN_SUBDOMAINS === "true")
        ? origin
        : null,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Dev-Token"],
    maxAge: 86400,
  })(c, next);
});

// ── OAuth endpoints ───────────────────────────────────────────────────────

app.get("/.well-known/oauth-protected-resource", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleProtectedResource(c.req.raw);
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleMetadata(c.req.raw);
});

app.post("/register", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleRegister(c.req.raw, c.env);
});

app.get("/authorize", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  const provider = c.env.DEFAULT_OAUTH_PROVIDER ?? "github";
  return handleAuthorize(c.req.raw, c.env, provider);
});

app.get("/authorize/:provider{[a-z][a-z0-9]*}", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleAuthorize(c.req.raw, c.env, c.req.param("provider"));
});

app.get("/oauth/callback", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleCallback(c.req.raw, c.env);
});

app.post("/token", (c) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return handleToken(c.req.raw, c.env);
});

// ── Google Keep integration routes ───────────────────────────────────────

app.get("/integrations/google", (c) => handleGetIntegrationStatus(c.req.raw, c.env));
app.post("/integrations/google/authorize", (c) => handleGoogleAuthorize(c.req.raw, c.env));
app.get("/integrations/google/callback", (c) => handleGoogleCallback(c.req.raw, c.env));
app.delete("/integrations/google", (c) => handleDeleteIntegration(c.req.raw, c.env));
app.put("/integrations/google", (c) => handleUpdateIntegration(c.req.raw, c.env));
app.post("/integrations/google/exchange-oauth-token", (c) => handleExchangeOAuthToken(c.req.raw, c.env));
app.post("/integrations/google/manual-token", (c) => handleManualToken(c.req.raw, c.env));
app.post("/integrations/google/keep/export", (c) => handleExportToKeep(c.req.raw, c.env));

// ── MCP endpoint ─────────────────────────────────────────────────────────

app.post("/mcp", async (c) => {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  return handleMcp(c.req.raw, c.env, auth.userId);
});

// ── Root ─────────────────────────────────────────────────────────────────

app.get("/", (c) => c.text("grocery-store MCP server"));

export default app;
