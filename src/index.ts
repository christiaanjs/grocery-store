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

function corsHeaders(origin: string, env: Env): Record<string, string> {
  if (!isAllowedOrigin(origin, env.ALLOWED_ORIGIN, env.ALLOW_ORIGIN_SUBDOMAINS === "true")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dev-Token",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(response: Response, origin: string, env: Env): Response {
  const headers = corsHeaders(origin, env);
  if (Object.keys(headers).length === 0) return response;
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) next.headers.set(k, v);
  return next;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };
    const origin = request.headers.get("Origin") ?? "";

    // Handle CORS preflight for cross-origin requests from the frontend
    if (method === "OPTIONS") {
      const cors = corsHeaders(origin, env);
      if (Object.keys(cors).length > 0) {
        return new Response(null, { status: 204, headers: cors });
      }
    }

    if (env.ENABLE_OAUTH === "true") {
      if (method === "GET" && pathname === "/.well-known/oauth-protected-resource") {
        return withCors(handleProtectedResource(request), origin, env);
      }
      if (method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
        return withCors(handleMetadata(request), origin, env);
      }
      if (method === "POST" && pathname === "/register") {
        return withCors(await handleRegister(request, env), origin, env);
      }
      if (method === "GET" && pathname === "/authorize") {
        const provider = env.DEFAULT_OAUTH_PROVIDER ?? "github";
        return withCors(await handleAuthorize(request, env, provider), origin, env);
      }
      if (method === "GET") {
        const providerMatch = pathname.match(/^\/authorize\/([a-z][a-z0-9]*)$/);
        if (providerMatch?.[1]) {
          return withCors(await handleAuthorize(request, env, providerMatch[1]), origin, env);
        }
      }
      if (method === "GET" && pathname === "/oauth/callback") {
        return withCors(await handleCallback(request, env), origin, env);
      }
      if (method === "POST" && pathname === "/token") {
        return withCors(await handleToken(request, env), origin, env);
      }
    }

    // ── Google Keep integration routes ───────────────────────────────────
    if (method === "GET" && pathname === "/integrations/google") {
      return withCors(await handleGetIntegrationStatus(request, env), origin, env);
    }
    if (method === "POST" && pathname === "/integrations/google/authorize") {
      return withCors(await handleGoogleAuthorize(request, env), origin, env);
    }
    if (method === "GET" && pathname === "/integrations/google/callback") {
      // Not wrapped in CORS — this is a browser redirect from Google
      return handleGoogleCallback(request, env);
    }
    if (method === "DELETE" && pathname === "/integrations/google") {
      return withCors(await handleDeleteIntegration(request, env), origin, env);
    }
    if (method === "PUT" && pathname === "/integrations/google") {
      return withCors(await handleUpdateIntegration(request, env), origin, env);
    }
    if (method === "POST" && pathname === "/integrations/google/exchange-oauth-token") {
      return withCors(await handleExchangeOAuthToken(request, env), origin, env);
    }
    if (method === "POST" && pathname === "/integrations/google/manual-token") {
      return withCors(await handleManualToken(request, env), origin, env);
    }
    if (method === "POST" && pathname === "/integrations/google/keep/export") {
      return withCors(await handleExportToKeep(request, env), origin, env);
    }

    if (method === "POST" && pathname === "/mcp") {
      const auth = await authenticate(request, env);
      if (!auth) {
        return withCors(new Response("Unauthorized", { status: 401 }), origin, env);
      }
      return withCors(await handleMcp(request, env, auth.userId), origin, env);
    }

    if (pathname === "/") {
      return new Response("grocery-store MCP server", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
