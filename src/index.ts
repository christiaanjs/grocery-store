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

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  if (!allowedOrigin || origin !== allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function withCors(response: Response, origin: string, allowedOrigin: string): Response {
  const headers = corsHeaders(origin, allowedOrigin);
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
      const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
      if (Object.keys(cors).length > 0) {
        return new Response(null, { status: 204, headers: cors });
      }
    }

    if (env.ENABLE_OAUTH === "true") {
      if (method === "GET" && pathname === "/.well-known/oauth-protected-resource") {
        return withCors(handleProtectedResource(request), origin, env.ALLOWED_ORIGIN);
      }
      if (method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
        return withCors(handleMetadata(request), origin, env.ALLOWED_ORIGIN);
      }
      if (method === "POST" && pathname === "/register") {
        return withCors(await handleRegister(request, env), origin, env.ALLOWED_ORIGIN);
      }
      if (method === "GET" && pathname === "/authorize") {
        return withCors(await handleAuthorize(request, env), origin, env.ALLOWED_ORIGIN);
      }
      if (method === "GET" && pathname === "/oauth/callback") {
        return withCors(await handleCallback(request, env), origin, env.ALLOWED_ORIGIN);
      }
      if (method === "POST" && pathname === "/token") {
        return withCors(await handleToken(request, env), origin, env.ALLOWED_ORIGIN);
      }
    }

    if (method === "POST" && pathname === "/mcp") {
      const auth = await authenticate(request, env);
      if (!auth) {
        return withCors(new Response("Unauthorized", { status: 401 }), origin, env.ALLOWED_ORIGIN);
      }
      return withCors(await handleMcp(request, env, auth.userId), origin, env.ALLOWED_ORIGIN);
    }

    if (pathname === "/") {
      return new Response("grocery-store MCP server", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
