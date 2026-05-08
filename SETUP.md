# Bootstrap guide

Manual steps to get the project running end-to-end.

---

## Prerequisites

- Node 22 (`nvm use` will pick it up from `.nvmrc`)
- A Cloudflare account
- Wrangler authenticated: `wrangler login`

---

## Local development

### 1. Create the D1 database

```bash
wrangler d1 create grocery-store-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`.

### 2. Register a GitHub OAuth App for localhost

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|-------|-------|
| Application name | Grocery Store (local) |
| Homepage URL | `http://localhost:8787` |
| Authorization callback URL | `http://localhost:8787/oauth/callback` |

Save the **Client ID** and generate a **Client Secret**.

### 3. Create `.dev.vars`

This file is gitignored. Create it at the project root:

```
GITHUB_CLIENT_ID=<client-id from step 2>
GITHUB_CLIENT_SECRET=<client-secret from step 2>
JWT_SECRET=<any random string, min 32 chars — e.g. openssl rand -hex 32>
ALLOWED_ORIGIN=http://localhost:5173
```

`ENABLE_DEV_AUTH`, `DEV_TOKEN`, and `DEV_USER_ID` are optional — only needed for curl testing or to use `VITE_DEV_TOKEN` in the browser frontend. `ENABLE_DEV_AUTH` is intentionally absent from `wrangler.toml` so the dev token path is dead in production even if `DEV_TOKEN` is accidentally set as a secret.

### 4. Create `frontend/.env.local`

```
VITE_WORKER_URL=http://localhost:8787
```

### 5. Apply migrations and start both servers

```bash
npm run migrate:local

# Terminal 1 — Worker
npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`. Sign in with GitHub and you're good to go.

### 6. curl testing (optional)

If you also want to test with curl, add to `.dev.vars`:

```
ENABLE_DEV_AUTH=true
DEV_TOKEN=any-string-you-choose
DEV_USER_ID=usr_local
```

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: <your DEV_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Production deployment

### Register a GitHub OAuth App for production

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|-------|-------|
| Application name | Grocery Store |
| Homepage URL | your Worker URL |
| Authorization callback URL | `https://<your-worker>.workers.dev/oauth/callback` |

### Set production secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put JWT_SECRET        # openssl rand -hex 32
```

### Deploy the Worker

```bash
npm run migrate:prod
npm run deploy
```

The deploy CI workflow (`deploy-prod.yml`) can also be triggered manually from GitHub Actions.

### Deploy the frontend

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=grocery-store-frontend
```

Or trigger the `deploy-pages.yml` workflow from GitHub Actions.

### Connect to Claude.ai

1. Go to **Claude.ai → Customize → Connectors → + → Add custom connector**
2. Enter your MCP server URL: `https://<your-worker>.workers.dev/mcp`
3. Click **Add**, then complete the GitHub OAuth flow

Claude.ai uses Dynamic Client Registration (DCR) — no manual client ID/secret entry needed.

---

## Production migrations

Any time a new migration is added, apply it before deploying:

```bash
npm run migrate:prod
npm run deploy
```
