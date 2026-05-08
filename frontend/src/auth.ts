const WORKER_BASE = import.meta.env.VITE_WORKER_URL ?? "";
const COOKIE_CLIENT = "oauth_client_id";
const COOKIE_ACCESS = "oauth_access_token";
const COOKIE_REFRESH = "oauth_refresh_token";
const COOKIE_EXP = "oauth_exp";
const COOKIE_VERIFIER = "oauth_code_verifier";

const REFRESH_TTL = 30 * 24 * 3600; // 30 days in seconds
const CLIENT_TTL = 365 * 24 * 3600; // 1 year
const VERIFIER_TTL = 900; // 15 minutes

// ── Cookie helpers ────────────────────────────────────────────────────────

// Cookies are shared between iOS home screen apps and Safari at the same origin,
// unlike localStorage/sessionStorage which are isolated per context on iOS.
const _secure = location.protocol === "https:" ? "; Secure" : "";

function setCookie(name: string, value: string, maxAgeSec: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSec}; path=/; SameSite=Lax${_secure}`;
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/`;
}

// One-time migration: move any pre-existing tokens from localStorage into cookies.
// Needed so users who logged in before this update don't lose their session.
(function migrateFromLocalStorage() {
  const legacyAccess = localStorage.getItem("oauth_access_token");
  if (!legacyAccess || getCookie(COOKIE_ACCESS)) return;

  const legacyRefresh = localStorage.getItem("oauth_refresh_token");
  const legacyExp = localStorage.getItem("oauth_exp");
  const legacyClient = localStorage.getItem("oauth_client_id");

  setCookie(COOKIE_ACCESS, legacyAccess, 3600);
  if (legacyRefresh) setCookie(COOKIE_REFRESH, legacyRefresh, REFRESH_TTL);
  if (legacyExp) setCookie(COOKIE_EXP, legacyExp, REFRESH_TTL);
  if (legacyClient) setCookie(COOKIE_CLIENT, legacyClient, CLIENT_TTL);

  ["oauth_access_token", "oauth_refresh_token", "oauth_exp", "oauth_client_id", "oauth_code_verifier"].forEach(
    k => localStorage.removeItem(k)
  );
})();

// ── Standalone detection ──────────────────────────────────────────────────

export function isStandalone(): boolean {
  return Boolean(
    (navigator as { standalone?: boolean }).standalone ||
    window.matchMedia("(display-mode: standalone)").matches,
  );
}

// ── PKCE helpers ──────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeVerifier(): Promise<string> {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return base64url(buf.buffer);
}

async function codeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64url(digest);
}

// ── DCR ───────────────────────────────────────────────────────────────────

async function ensureClientId(): Promise<string> {
  let clientId = getCookie(COOKIE_CLIENT);
  if (clientId) return clientId;

  const res = await fetch(`${WORKER_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [`${location.origin}/callback`],
    }),
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const data = (await res.json()) as { client_id: string };
  clientId = data.client_id;
  setCookie(COOKIE_CLIENT, clientId, CLIENT_TTL);
  return clientId;
}

// ── Token storage ─────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return getCookie(COOKIE_ACCESS);
}

function storeTokens(accessToken: string, refreshToken: string, expiresIn: number) {
  setCookie(COOKIE_ACCESS, accessToken, expiresIn);
  setCookie(COOKIE_REFRESH, refreshToken, REFRESH_TTL);
  setCookie(COOKIE_EXP, String(Date.now() + expiresIn * 1000), REFRESH_TTL);
}

export function clearTokens() {
  deleteCookie(COOKIE_ACCESS);
  deleteCookie(COOKIE_REFRESH);
  deleteCookie(COOKIE_EXP);
  deleteCookie(COOKIE_VERIFIER);
}

function isExpiringSoon(): boolean {
  const exp = getCookie(COOKIE_EXP);
  if (!exp) return true;
  return Date.now() > Number(exp) - 5 * 60 * 1000; // 5 min buffer
}

// ── Refresh ───────────────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getCookie(COOKIE_REFRESH);
  const clientId = getCookie(COOKIE_CLIENT);
  if (!refreshToken || !clientId) return false;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(`${WORKER_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error === "invalid_grant") clearTokens();
    return false;
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  storeTokens(data.access_token, data.refresh_token, data.expires_in);
  return true;
}

// ── Auth flow entry points ────────────────────────────────────────────────

export async function startLogin() {
  const clientId = await ensureClientId();
  const verifier = await generateCodeVerifier();
  const challenge = await codeChallenge(verifier);
  setCookie(COOKIE_VERIFIER, verifier, VERIFIER_TTL);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${location.origin}/callback`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: crypto.randomUUID(),
  });

  location.href = `${WORKER_BASE}/authorize?${params}`;
}

export async function handleCallback(searchParams: URLSearchParams): Promise<void> {
  const code = searchParams.get("code");
  if (!code) throw new Error("No code in callback URL");

  const verifier = getCookie(COOKIE_VERIFIER);
  if (!verifier) throw new Error("No code_verifier found — please start the login flow again");

  const clientId = getCookie(COOKIE_CLIENT);
  if (!clientId) throw new Error("No client_id stored");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: `${location.origin}/callback`,
    client_id: clientId,
  });

  const res = await fetch(`${WORKER_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  storeTokens(data.access_token, data.refresh_token, data.expires_in);
  deleteCookie(COOKIE_VERIFIER);
}

// ── Token getter with auto-refresh ───────────────────────────────────────

export async function getValidToken(): Promise<string | null> {
  const token = getAccessToken();
  // Try to refresh if absent (e.g. cookie expired after 1 h) or expiring soon
  if (!token || isExpiringSoon()) {
    const ok = await refreshAccessToken();
    return ok ? getAccessToken() : null;
  }
  return token;
}
