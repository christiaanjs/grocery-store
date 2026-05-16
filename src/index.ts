import { Hono } from "hono/tiny";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { Env } from "./types.ts";
import { authenticate } from "./auth/middleware.ts";
import { handleMcp } from "./mcp/server.ts";
import { oauthRouter } from "./auth/oauth.ts";
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

type Variables = { userId: string };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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

const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth) return new Response("Unauthorized", { status: 401 });
  c.set("userId", auth.userId);
  return next();
});

// ── OAuth endpoints ───────────────────────────────────────────────────────

app.route("/", oauthRouter);

// ── Google Keep integration routes ───────────────────────────────────────

app.route("/integrations/google", googleRouter);

// ── MCP endpoint ─────────────────────────────────────────────────────────

app.post("/mcp", requireAuth, (c) => handleMcp(c.req.raw, c.env, c.get("userId")));

// ── Root ─────────────────────────────────────────────────────────────────

app.get("/", (c) => c.text("grocery-store MCP server"));

export default app;
