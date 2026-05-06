# Bootstrap guide

Manual steps to get the project running. Phase 1 gets you a curl-testable MCP server;
Phase 2 wires up OAuth so you can connect it to Claude.ai.

---

## Prerequisites

- Node 22 (`nvm use` will pick it up from `.nvmrc`)
- A Cloudflare account
- Wrangler authenticated: `wrangler login`

---

## Phase 1 — local dev with curl

### 1. Create the D1 database

```bash
wrangler d1 create grocery-store-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "grocery-store-db"
database_id = "<paste here>"
```

### 2. Create `.dev.vars`

This file is gitignored. Create it at the project root:

```
DEV_TOKEN=any-string-you-choose
DEV_USER_ID=usr_local
```

`DEV_TOKEN` is what you'll put in the `X-Dev-Token` header when testing with curl.
`DEV_USER_ID` is the user ID the middleware injects for all dev requests.

### 3. Apply migrations locally

Once the initial migration file exists (Claude will create it):

```bash
npm run migrate:local
```

### 4. Run the dev server

```bash
npm run dev
```

The Worker starts at `http://localhost:8787`. Test the MCP endpoint:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: <your DEV_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Phase 2 — deploy and connect to Claude.ai

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

Note the Worker URL from the output (e.g. `https://grocery-store.<your-subdomain>.workers.dev`).

### 6. Register a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|-------|-------|
| Application name | Grocery Store |
| Homepage URL | your Worker URL |
| Authorization callback URL | `https://<your-worker>.workers.dev/oauth/callback` |

Save the **Client ID** and generate a **Client Secret**.

### 7. Set production secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put JWT_SECRET        # any long random string, e.g. openssl rand -hex 32
```

### 8. Enable OAuth

In `wrangler.toml`, flip the feature flag:

```toml
[vars]
ENABLE_OAUTH = "true"
```

Redeploy: `npm run deploy`

### 9. Add the connector in Claude.ai

1. Go to **Claude.ai → Customize → Connectors → + → Add custom connector**
2. Enter your MCP server URL: `https://<your-worker>.workers.dev/mcp`
3. Under **Advanced settings**, enter the OAuth **Client ID** and **Client Secret**
   (from step 6) — required because the server doesn't implement Dynamic Client
   Registration
4. Click **Add**, then go through the GitHub OAuth flow to authenticate

---

## Production migrations

Any time a new migration is added, apply it before deploying:

```bash
npm run migrate:prod
npm run deploy
```
