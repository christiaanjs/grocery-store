import type { Env } from "./types.ts";
import { authenticate } from "./auth/middleware.ts";
import { handleMcp } from "./mcp/server.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/mcp") {
      const auth = authenticate(request, env);
      if (!auth) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handleMcp(request, env, auth.userId);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
