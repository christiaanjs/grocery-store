// Minimal port of gpsoauth for Google Keep integration.
// Calls the Android auth endpoint to obtain and use a master token.
const AUTH_URL = "https://android.clients.google.com/auth";
const USER_AGENT = "GoogleAuth/1.4";
const KEEP_APP = "com.google.android.keep";
const KEEP_CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788";
const KEEP_SCOPES =
  "oauth2:https://www.googleapis.com/auth/memento https://www.googleapis.com/auth/reminders";

function parseAuthResponse(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
}

async function performAuthRequest(
  data: Record<string, string | number>,
): Promise<Record<string, string>> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) body.set(k, String(v));
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Accept-Encoding": "identity",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: body.toString(),
  });
  const text = await res.text();
  const parsed = parseAuthResponse(text);
  if (parsed["Error"]) {
    console.error("[gpsoauth] Android auth error response:", {
      httpStatus: res.status,
      error: parsed["Error"],
      info: parsed["Info"],
      detail: parsed["Detail"],
      userMessage: parsed["UserMessage"],
      cause: parsed["Cause"],
    });
  }
  return parsed;
}

// Exchange a Google OAuth access token for a long-lived master token.
export async function exchangeToken(
  email: string,
  oauthToken: string,
  androidId: string,
): Promise<Record<string, string>> {
  return performAuthRequest({
    accountType: "HOSTED_OR_GOOGLE",
    Email: email,
    has_permission: 1,
    add_account: 1,
    ACCESS_TOKEN: 1,
    Token: oauthToken,
    service: "ac2dm",
    source: "android",
    androidId,
    device_country: "us",
    operatorCountry: "us",
    lang: "en",
    sdk_version: 17,
    google_play_services_version: 240913000,
    client_sig: KEEP_CLIENT_SIG,
    callerSig: KEEP_CLIENT_SIG,
    droidguard_results: "dummy123",
  });
}

// Use a master token to obtain a Keep-scoped OAuth token.
export async function getKeepAuthToken(
  email: string,
  masterToken: string,
  androidId: string,
): Promise<string> {
  const res = await performAuthRequest({
    accountType: "HOSTED_OR_GOOGLE",
    Email: email,
    has_permission: 1,
    EncryptedPasswd: masterToken,
    service: KEEP_SCOPES,
    source: "android",
    androidId,
    app: KEEP_APP,
    client_sig: KEEP_CLIENT_SIG,
    device_country: "us",
    operatorCountry: "us",
    lang: "en",
    sdk_version: 17,
    google_play_services_version: 240913000,
  });
  const token = res["Auth"] ?? res["Token"];
  if (!token) {
    const knownFields = ["Error", "Info", "Detail", "UserMessage", "Cause"];
    const context = knownFields
      .filter(k => res[k])
      .map(k => `${k}=${res[k]}`)
      .join(", ");
    throw new Error(`${res["Error"] ?? "no auth token in response"}${context ? ` (${context})` : ""}`);
  }
  return token;
}
