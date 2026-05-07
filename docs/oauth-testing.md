# OAuth Testing Guide

How to test the GitHub OAuth flow against the staging Worker before deploying to production.

**Staging URL:** `https://grocery-store-staging.grocery-store.workers.dev`  
**Production URL:** `https://grocery-store.grocery-store.workers.dev`

---

## First-time staging setup

### 1. Create a staging D1 database

```bash
wrangler d1 create grocery-store-db-staging
```

Copy the printed `database_id` into `wrangler.toml` under `[env.staging]`.

### 2. Create a GitHub OAuth App for staging

In GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

| Field | Value |
|---|---|
| Application name | grocery-store-staging |
| Homepage URL | `https://grocery-store-staging.grocery-store.workers.dev` |
| Authorization callback URL | `https://grocery-store-staging.grocery-store.workers.dev/oauth/callback` |

Save the **Client ID** and generate a **Client secret**.

### 3. Set staging secrets

```bash
wrangler secret put GITHUB_CLIENT_ID --env staging
wrangler secret put GITHUB_CLIENT_SECRET --env staging
wrangler secret put JWT_SECRET --env staging        # any random 32+ char string
wrangler secret put DEV_TOKEN --env staging         # optional, for curl testing
wrangler secret put DEV_USER_ID --env staging       # optional, e.g. usr_local
```

### 4. Apply migrations and deploy

```bash
wrangler d1 migrations apply grocery-store-db-staging --env staging --remote
wrangler deploy --env staging
```

---

## Curl testing (dev token — no OAuth required)

Set `DEV_TOKEN` and `DEV_USER_ID` in `.dev.vars` for local testing, or as secrets
for staging testing. Then:

```bash
BASE=http://localhost:8787          # local
# BASE=https://grocery-store-staging.grocery-store.workers.dev  # staging

TOKEN="your-dev-token"

# Check auth
curl -s -X POST $BASE/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | jq

# List tools
curl -s -X POST $BASE/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: $TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq

# Add a pantry item
curl -s -X POST $BASE/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: $TOKEN" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pantry_update","arguments":{"name":"Eggs","quantity":12,"unit":"count","in_stock":true}}}' | jq
```

---

## Curl testing — full OAuth flow (staging)

This walks through every endpoint in order so you end up with a real JWT to use
against `/mcp`.

```bash
BASE=https://grocery-store-staging.grocery-store.workers.dev
```

### Step 1 — Verify metadata discovery

```bash
curl -s $BASE/.well-known/oauth-authorization-server | jq
```

Expected: JSON with `authorization_endpoint`, `token_endpoint`, `registration_endpoint`.

### Step 2 — Register a client (DCR)

```bash
REGISTER=$(curl -s -X POST $BASE/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["https://grocery-store-staging.grocery-store.workers.dev/oauth/callback"]}')

echo $REGISTER | jq
CLIENT_ID=$(echo $REGISTER | jq -r .client_id)
echo "Client ID: $CLIENT_ID"
```

### Step 3 — Generate a PKCE pair

```bash
# Generate a random verifier (43-128 URL-safe chars)
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=+/' | head -c 43)

# Derive the challenge: base64url(SHA-256(verifier))
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d '=' | tr '+/' '-_')

echo "Verifier:  $CODE_VERIFIER"
echo "Challenge: $CODE_CHALLENGE"
```

### Step 4 — Start the authorization flow in a browser

Construct this URL and open it in a browser:

```
https://grocery-store-staging.grocery-store.workers.dev/authorize
  ?response_type=code
  &client_id=<CLIENT_ID>
  &redirect_uri=https://grocery-store-staging.grocery-store.workers.dev/oauth/callback
  &code_challenge=<CODE_CHALLENGE>
  &code_challenge_method=S256
  &state=test123
```

One-liner to build and open (macOS):

```bash
REDIRECT_URI="https://grocery-store-staging.grocery-store.workers.dev/oauth/callback"

open "${BASE}/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$REDIRECT_URI")&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256&state=test123"
```

GitHub will ask you to authorize. After you approve, the Worker exchanges the GitHub
code for a user record and issues an MCP auth code, then redirects to
`https://claude.ai/api/mcp/auth_callback?code=<AUTH_CODE>&state=test123`.

The browser will show a claude.ai error page (expected — Claude didn't initiate this
flow). **Copy the `code` query parameter from the URL bar.**

```bash
AUTH_CODE="<paste code here>"
```

### Step 5 — Exchange the auth code for tokens

```bash
TOKENS=$(curl -s -X POST $BASE/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=${AUTH_CODE}&redirect_uri=${REDIRECT_URI}&code_verifier=${CODE_VERIFIER}&client_id=${CLIENT_ID}")

echo $TOKENS | jq
ACCESS_TOKEN=$(echo $TOKENS | jq -r .access_token)
REFRESH_TOKEN=$(echo $TOKENS | jq -r .refresh_token)
echo "Access token: $ACCESS_TOKEN"
```

### Step 6 — Call an MCP tool with the JWT

```bash
curl -s -X POST $BASE/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

### Step 7 — Refresh the access token

```bash
NEW_TOKENS=$(curl -s -X POST $BASE/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}")

echo $NEW_TOKENS | jq
ACCESS_TOKEN=$(echo $NEW_TOKENS | jq -r .access_token)
REFRESH_TOKEN=$(echo $NEW_TOKENS | jq -r .refresh_token)
```

---

## Testing end-to-end with Claude.ai

Once the staging Worker is deployed and the GitHub OAuth App is configured:

1. In Claude.ai, go to **Settings → Integrations** (or the MCP panel).
2. Add a new MCP server with URL `https://grocery-store-staging.grocery-store.workers.dev`.
3. Claude will call `/.well-known/oauth-authorization-server`, register itself via `/register`,
   then open a browser window for GitHub authorization.
4. After you approve, Claude will exchange the code for tokens automatically and start
   sending MCP requests.

When staging works end-to-end, deploy to production:

```bash
wrangler d1 migrations apply grocery-store-db --remote
wrangler deploy
```

Production uses a separate GitHub OAuth App whose callback URL is:
`https://grocery-store.grocery-store.workers.dev/oauth/callback`
