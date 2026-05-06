import type { Env } from "../types.ts";
import { verifyJwt } from "./jwt.ts";

export interface AuthContext {
  userId: string;
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  // Phase 1: dev token (curl testing only)
  const devToken = request.headers.get("X-Dev-Token");
  if (devToken && devToken === env.DEV_TOKEN) {
    return { userId: env.DEV_USER_ID };
  }

  // Phase 2: OAuth JWT Bearer token
  if (env.ENABLE_OAUTH === "true") {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyJwt(token, env.JWT_SECRET);
      if (payload) {
        return { userId: payload.sub };
      }
    }
  }

  return null;
}
