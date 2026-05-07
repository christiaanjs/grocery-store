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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    if (env.ENABLE_OAUTH === "true") {
      if (method === "GET" && pathname === "/.well-known/oauth-protected-resource") {
        return handleProtectedResource(request);
      }
      if (method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
        return handleMetadata(request);
      }
      if (method === "POST" && pathname === "/register") {
        return handleRegister(request, env);
      }
      if (method === "GET" && pathname === "/authorize") {
        return handleAuthorize(request, env);
      }
      if (method === "GET" && pathname === "/oauth/callback") {
        return handleCallback(request, env);
      }
      if (method === "POST" && pathname === "/token") {
        return handleToken(request, env);
      }
    }

    // Accept MCP requests at both / (Claude.ai sends to the base URL you provide)
    // and /mcp (for curl testing).
    if (method === "POST" && (pathname === "/" || pathname === "/mcp")) {
      const auth = await authenticate(request, env);
      if (!auth) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handleMcp(request, env, auth.userId);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
