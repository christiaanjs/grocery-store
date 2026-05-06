import type { Env } from "../types.ts";

export interface AuthContext {
  userId: string;
}

export function authenticate(request: Request, env: Env): AuthContext | null {
  const devToken = request.headers.get("X-Dev-Token");
  if (devToken && devToken === env.DEV_TOKEN) {
    return { userId: env.DEV_USER_ID };
  }
  // Phase 2: validate JWT Bearer token
  return null;
}
