import { useState, useEffect } from "preact/hooks";
import { getAccessToken, startLogin, handleCallback, clearTokens, isStandalone } from "./auth.ts";
import { AuthError } from "./api.ts";
import { Pantry } from "./views/Pantry.tsx";
import { MealPlan } from "./views/MealPlan.tsx";
import { parseUrl, pushUrl, type Tab, type Filter, type UrlState } from "./hooks/useUrlState.ts";

const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN as string | undefined;

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [returnToApp, setReturnToApp] = useState(false);

  const [tab, setTab] = useState<Tab>(() => parseUrl().tab);
  const [initialFilter, setInitialFilter] = useState<Filter>(() => parseUrl().filter);
  const [initialSearch, setInitialSearch] = useState<string>(() => parseUrl().search);
  const [initialFrom, setInitialFrom] = useState<string | undefined>(() => parseUrl().from);
  const [initialTo, setInitialTo] = useState<string | undefined>(() => parseUrl().to);
  const [viewKey, setViewKey] = useState(0);

  useEffect(() => {
    // Dev token bypasses OAuth entirely — no GitHub login required
    if (DEV_TOKEN) {
      setAuthed(true);
      return;
    }

    const params = new URLSearchParams(location.search);

    if (location.pathname === "/callback") {
      handleCallback(params)
        .then(() => {
          // On iOS, the callback may arrive in Safari (not the standalone PWA).
          // Tokens are now in shared cookies, so the PWA will find them when
          // the user switches back. Show a prompt instead of rendering the app.
          const onIOS = /iPhone|iPad/.test(navigator.userAgent);
          if (onIOS && !isStandalone()) {
            setReturnToApp(true);
          } else {
            history.replaceState(null, "", "/pantry");
            setAuthed(true);
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Auth failed";
          setCallbackError(msg);
          setAuthed(false);
        });
      return;
    }

    setAuthed(!!getAccessToken());
  }, []);

  // Re-check auth when the PWA comes back to foreground (e.g. after completing
  // GitHub OAuth in Safari on iOS — tokens are stored in shared cookies).
  useEffect(() => {
    if (authed !== false) return;
    function checkForTokens() {
      if (!document.hidden && getAccessToken()) setAuthed(true);
    }
    document.addEventListener("visibilitychange", checkForTokens);
    window.addEventListener("pageshow", checkForTokens);
    return () => {
      document.removeEventListener("visibilitychange", checkForTokens);
      window.removeEventListener("pageshow", checkForTokens);
    };
  }, [authed]);

  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const s = (e.state as UrlState | null) ?? parseUrl();
      setTab(s.tab);
      setInitialFilter(s.filter);
      setInitialSearch(s.search);
      setInitialFrom(s.from);
      setInitialTo(s.to);
      setViewKey(k => k + 1);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function switchTab(t: Tab) {
    setTab(t);
    pushUrl({
      tab: t,
      filter: t === "pantry" ? initialFilter : "all",
      search: t === "pantry" ? initialSearch : "",
      from: t === "meals" ? initialFrom : undefined,
      to: t === "meals" ? initialTo : undefined,
    });
  }

  function onAuthError(err: unknown) {
    if (err instanceof AuthError) {
      clearTokens();
      setAuthed(false);
    }
  }

  if (authed === null && !returnToApp) return <div class="loading">Loading…</div>;

  if (returnToApp) {
    return (
      <div class="login-screen">
        <h2>Grocery Store</h2>
        <p>You're signed in! Open the Grocery Store app from your home screen to continue.</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div class="login-screen">
        <h2>Grocery Store</h2>
        {callbackError && <p class="error-banner">{callbackError}</p>}
        <button class="login-btn" onClick={() => startLogin()}>
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return (
    <>
      <header class="app-header">
        <h1>Grocery Store</h1>
        <nav class="tab-bar">
          <button class={tab === "pantry" ? "active" : ""} onClick={() => switchTab("pantry")}>
            Pantry
          </button>
          <button class={tab === "meals" ? "active" : ""} onClick={() => switchTab("meals")}>
            Meal Plan
          </button>
        </nav>
        <div class="spacer" />
        {!DEV_TOKEN && (
          <button
            class="sign-out-btn"
            onClick={() => {
              clearTokens();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main class="app-main">
        {tab === "pantry" && (
          <Pantry
            key={viewKey}
            initialFilter={initialFilter}
            initialSearch={initialSearch}
            onAuthError={onAuthError}
          />
        )}
        {tab === "meals" && (
          <MealPlan
            key={viewKey}
            initialFrom={initialFrom}
            initialTo={initialTo}
            onAuthError={onAuthError}
          />
        )}
      </main>
    </>
  );
}
