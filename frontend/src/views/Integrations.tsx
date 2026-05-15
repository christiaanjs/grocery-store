import { useState, useEffect } from "preact/hooks";
import {
  getGoogleIntegrationStatus,
  startGoogleIntegrationConnect,
  disconnectGoogleIntegration,
  type IntegrationStatus,
} from "../api.ts";

function readCallbackResult(): { type: "success" | "error"; text: string } | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected") === "true") {
    return { type: "success", text: "Google Keep connected successfully!" };
  }
  const err = params.get("error");
  if (err) {
    const detail = params.get("detail") ?? params.get("google_email");
    const map: Record<string, string> = {
      email_mismatch: `The Google account email${detail ? ` (${detail})` : ""} does not match your account email. Sign in with the same email.`,
      master_token_error: `Google authentication failed${detail ? `: ${detail}` : ". Try reconnecting."} `,
      master_token_failed: `Could not contact Google auth service${detail ? `: ${detail}` : "."}`,
      email_not_verified: "The Google account email is not verified.",
      token_exchange_failed: "OAuth token exchange failed. Please try again.",
      invalid_state: "The connection request expired. Please try again.",
    };
    return { type: "error", text: map[err] ?? `Connection failed: ${err}${detail ? ` (${detail})` : ""}` };
  }
  return null;
}

export function Integrations({ onAuthError }: { onAuthError: (err: unknown) => void }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [callbackMsg] = useState(() => readCallbackResult());

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
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
