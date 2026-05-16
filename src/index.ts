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
import { googleRouter } from "./routes/integrations.ts";

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

const oauth = new Hono<{ Bindings: Env }>();

oauth.use("*", async (c, next) => {
  if (c.env.ENABLE_OAUTH !== "true") return c.notFound();
  return next();
});

oauth.get("/.well-known/oauth-protected-resource", (c) => handleProtectedResource(c.req.raw));
oauth.get("/.well-known/oauth-authorization-server", (c) => handleMetadata(c.req.raw));
oauth.post("/register", (c) => handleRegister(c.req.raw, c.env));
oauth.get("/authorize", (c) => handleAuthorize(c.req.raw, c.env, c.env.DEFAULT_OAUTH_PROVIDER ?? "github"));
oauth.get("/authorize/:provider{[a-z][a-z0-9]*}", (c) => handleAuthorize(c.req.raw, c.env, c.req.param("provider")));
oauth.get("/oauth/callback", (c) => handleCallback(c.req.raw, c.env));
oauth.post("/token", (c) => handleToken(c.req.raw, c.env));

app.route("/", oauth);

// ── Google Keep integration routes ───────────────────────────────────────

app.route("/integrations/google", googleRouter);

// ── MCP endpoint ─────────────────────────────────────────────────────────

app.post("/mcp", async (c) => {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  return handleMcp(c.req.raw, c.env, auth.userId);
});

// ── Root ─────────────────────────────────────────────────────────────────

app.get("/", (c) => c.text("grocery-store MCP server"));

export default app;
