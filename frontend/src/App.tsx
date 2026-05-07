import { useState, useEffect } from "preact/hooks";
import { getAccessToken, startLogin, handleCallback, clearTokens } from "./auth.ts";
import { AuthError } from "./api.ts";
import { Pantry } from "./views/Pantry.tsx";
import { MealPlan } from "./views/MealPlan.tsx";

type Tab = "pantry" | "meals";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading
  const [tab, setTab] = useState<Tab>("pantry");
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    if (location.pathname === "/callback") {
      handleCallback(params)
        .then(() => {
          history.replaceState(null, "", "/");
          setAuthed(true);
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

  function onAuthError(err: unknown) {
    if (err instanceof AuthError) {
      clearTokens();
      setAuthed(false);
    }
  }

  if (authed === null) return <div class="loading">Loading…</div>;

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
          <button class={tab === "pantry" ? "active" : ""} onClick={() => setTab("pantry")}>
            Pantry
          </button>
          <button class={tab === "meals" ? "active" : ""} onClick={() => setTab("meals")}>
            Meal Plan
          </button>
        </nav>
        <div class="spacer" />
        <button
          class="sign-out-btn"
          onClick={() => {
            clearTokens();
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>
      <main class="app-main">
        {tab === "pantry" && <Pantry onAuthError={onAuthError} />}
        {tab === "meals" && <MealPlan onAuthError={onAuthError} />}
      </main>
    </>
  );
}
