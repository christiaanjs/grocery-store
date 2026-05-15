import { useState, useEffect } from "preact/hooks";
import {
  getGoogleIntegrationStatus,
  startGoogleIntegrationConnect,
  disconnectGoogleIntegration,
  submitOAuthTokenExchange,
  submitManualMasterToken,
  type IntegrationStatus,
} from "../api.ts";

interface CallbackResult {
  type: "success" | "error";
  text: string;
  isTokenError?: boolean;
  googleEmail?: string;
}

function readCallbackResult(): CallbackResult | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "true") {
    return { type: "success", text: "Google Keep connected successfully!" };
  }
  const err = params.get("error");
  if (err) {
    const detail = params.get("detail") ?? undefined;
    const googleEmail = params.get("google_email") ?? undefined;
    const isTokenError = err === "master_token_error" || err === "master_token_failed";
    const map: Record<string, string> = {
      email_mismatch: `The Google account email${googleEmail ? ` (${googleEmail})` : ""} does not match your account email. Sign in with the same email.`,
      master_token_error: `Google authentication failed (${detail ?? "BadAuthentication"}). Use the alternative method below to connect manually.`,
      master_token_failed: `Could not reach the Google auth service${detail ? `: ${detail}` : "."} Use the alternative method below.`,
      email_not_verified: "The Google account email is not verified.",
      token_exchange_failed: "OAuth token exchange failed. Please try again.",
      invalid_state: "The connection request expired. Please try again.",
    };
    return {
      type: "error",
      text: map[err] ?? `Connection failed: ${err}${detail ? ` (${detail})` : ""}`,
      isTokenError,
      googleEmail,
    };
  }
  return null;
}

export function Integrations({ onAuthError }: { onAuthError: (err: unknown) => void }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [callbackMsg] = useState<CallbackResult | null>(() => readCallbackResult());

  // Alternative connection methods state
  const [showAlt, setShowAlt] = useState(() => callbackMsg?.isTokenError ?? false);
  const [altEmail, setAltEmail] = useState(() => callbackMsg?.googleEmail ?? "");

  // Tier 2: exchange oauth_token for master token
  const [exchangeOAuthToken, setExchangeOAuthToken] = useState("");
  const [exchangeSubmitting, setExchangeSubmitting] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  // Tier 3: enter master token directly (last resort)
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    // Remove OAuth callback params from the URL without a page reload
    const params = new URLSearchParams(window.location.search);
    if (params.has("connected") || params.has("error")) {
      window.history.replaceState(null, "", "/integrations");
    }
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getGoogleIntegrationStatus());
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { redirect_url } = await startGoogleIntegrationConnect();
      window.location.href = redirect_url;
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to start connection");
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectGoogleIntegration();
      setStatus({ connected: false });
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  async function submitExchange(e: Event) {
    e.preventDefault();
    setExchangeSubmitting(true);
    setExchangeError(null);
    try {
      await submitOAuthTokenExchange(altEmail, exchangeOAuthToken);
      setExchangeOAuthToken("");
      setShowAlt(false);
      await load();
    } catch (err) {
      setExchangeError(err instanceof Error ? err.message : "Failed to exchange token");
    } finally {
      setExchangeSubmitting(false);
    }
  }

  async function submitManual(e: Event) {
    e.preventDefault();
    setManualSubmitting(true);
    setManualError(null);
    try {
      await submitManualMasterToken(altEmail, manualToken);
      setManualToken("");
      setShowAlt(false);
      setShowManualFallback(false);
      await load();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setManualSubmitting(false);
    }
  }

  return (
    <div class="integrations-view">
      <h2 class="integrations-title">Integrations</h2>

      {callbackMsg && (
        <div class={`integrations-banner integrations-banner--${callbackMsg.type}`}>
          {callbackMsg.text}
        </div>
      )}

      {loading && <div class="loading">Loading…</div>}
      {error && <p class="inline-error">{error}</p>}

      {!loading && !error && (
        <div class="integration-card">
          <div class="integration-card-header">
            <div class="integration-icon">G</div>
            <div class="integration-info">
              <h3 class="integration-name">Google Keep</h3>
              <p class="integration-description">
                Export your grocery list to Google Keep as a checklist.
              </p>
            </div>
            <span
              class={`status-badge status-badge--${status?.connected ? "connected" : "disconnected"}`}
            >
              {status?.connected ? "Connected" : "Not connected"}
            </span>
          </div>

          <div class="integration-card-body">
            {status?.connected ? (
              <>
                <p class="integration-detail">
                  Connected as <strong>{status.email}</strong>
                </p>
                {status.keep_list_id && (
                  <p class="integration-detail">
                    Last export:{" "}
                    <a
                      href={`https://keep.google.com/u/0/#list/${status.keep_list_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="keep-link"
                    >
                      Open in Google Keep ↗
                    </a>
                  </p>
                )}
                <div class="integration-actions">
                  <button
                    class="btn-danger"
                    onClick={() => void disconnect()}
                    disabled={disconnecting}
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p class="integration-detail">
                  Connect your Google account to export grocery lists directly to Google Keep.
                  Your account email must match your Google account.
                </p>
                <div class="integration-actions">
                  <button
                    class="btn-primary"
                    onClick={() => void connect()}
                    disabled={connecting}
                  >
                    {connecting ? "Redirecting…" : "Connect Google Keep"}
                  </button>
                  {!showAlt && (
                    <button
                      class="btn-secondary"
                      onClick={() => setShowAlt(true)}
                    >
                      Having trouble? Try alternative methods
                    </button>
                  )}
                </div>

                {showAlt && (
                  <div class="manual-token-section">
                    <h4 class="manual-token-title">Alternative connection methods</h4>
                    <p class="manual-token-desc">
                      If the automatic method fails, you can connect by obtaining an OAuth token
                      directly from Google and exchanging it for a master token:
                    </p>

                    <ol class="manual-token-steps">
                      <li>
                        Go to{" "}
                        <a
                          href="https://accounts.google.com/EmbeddedSetup"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          accounts.google.com/EmbeddedSetup
                        </a>
                      </li>
                      <li>Log into your Google Account</li>
                      <li>
                        Click <strong>I agree</strong> when prompted (the page may show a loading
                        screen — that’s expected)
                      </li>
                      <li>
                        Open browser DevTools → Application → Cookies and copy the value of the{" "}
                        <code>oauth_token</code> cookie
                      </li>
                    </ol>

                    <form onSubmit={(e) => void submitExchange(e)} class="manual-token-form">
                      <label class="manual-token-label">
                        Google account email
                        <input
                          type="email"
                          class="manual-token-input"
                          value={altEmail}
                          onInput={(e) => setAltEmail((e.target as HTMLInputElement).value)}
                          required
                          placeholder="you@gmail.com"
                        />
                      </label>
                      <label class="manual-token-label">
                        OAuth token (<code>oauth_token</code> cookie value)
                        <input
                          type="text"
                          class="manual-token-input"
                          value={exchangeOAuthToken}
                          onInput={(e) =>
                            setExchangeOAuthToken((e.target as HTMLInputElement).value)
                          }
                          required
                          placeholder="oauth2_4/..."
                          autocomplete="off"
                        />
                      </label>
                      {exchangeError && <p class="inline-error">{exchangeError}</p>}
                      <div class="manual-token-actions">
                        <button
                          type="submit"
                          class="btn-primary"
                          disabled={exchangeSubmitting}
                        >
                          {exchangeSubmitting ? "Exchanging…" : "Exchange & connect"}
                        </button>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() => {
                            setShowAlt(false);
                            setShowManualFallback(false);
                            setExchangeError(null);
                            setManualError(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>

                    {!showManualFallback && (
                      <button
                        class="btn-secondary"
                        style="margin-top: 0.75rem;"
                        onClick={() => setShowManualFallback(true)}
                      >
                        Still having trouble? Enter master token directly
                      </button>
                    )}

                    {showManualFallback && (
                      <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color, #e0e0e0);">
                        <h5 class="manual-token-title" style="font-size: 0.9rem;">
                          Last resort: enter master token directly
                        </h5>
                        <p class="manual-token-desc" style="font-size: 0.85rem;">
                          If the exchange method above fails, you can paste the{" "}
                          <code>oauth_token</code> cookie value below as-is to use it directly
                          as a master token.
                        </p>
                        <form
                          onSubmit={(e) => void submitManual(e)}
                          class="manual-token-form"
                        >
                          <label class="manual-token-label">
                            Master token
                            <input
                              type="text"
                              class="manual-token-input"
                              value={manualToken}
                              onInput={(e) =>
                                setManualToken((e.target as HTMLInputElement).value)
                              }
                              required
                              placeholder="oauth2_4/..."
                              autocomplete="off"
                            />
                          </label>
                          {manualError && <p class="inline-error">{manualError}</p>}
                          <div class="manual-token-actions">
                            <button
                              type="submit"
                              class="btn-primary"
                              disabled={manualSubmitting}
                            >
                              {manualSubmitting ? "Verifying…" : "Save token"}
                            </button>
                            <button
                              type="button"
                              class="btn-secondary"
                              onClick={() => {
                                setShowManualFallback(false);
                                setManualError(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
