# Grocery Store — Claude Code Guide

## Current status

**Phase 2 complete.** GitHub OAuth 2.1 + PKCE is implemented. Browser frontend (Preact + Vite + FullCalendar) is deployed on Cloudflare Pages. Both Claude.ai and the browser UI authenticate via the same OAuth server.

---

## Project overview

A remote MCP server that gives Claude persistent memory for weekly dinner planning, with a browser UI for direct pantry and meal-plan management.
Core features: pantry/grocery tracking (what's in stock, what's run out), meal planning with a drag-and-drop calendar.

**Stack:**
- Cloudflare Worker (MCP server + OAuth 2.1)
- Cloudflare Pages (browser frontend — Preact + Vite + FullCalendar)
- Cloudflare D1 (SQLite — pantry, meal plans, users)
- TypeScript throughout (shared types in `types/shared.ts`)
- Wrangler for local dev and deployment
- GitHub Actions for CI/CD

---

## Repository structure

```
/
├── src/                      # Cloudflare Worker
│   ├── index.ts              # Entry point — routing + CORS
│   ├── mcp/
│   │   ├── server.ts         # MCP protocol handler
│   │   └── tools/
│   │       ├── pantry.ts
│   │       └── meals.ts
│   ├── auth/
│   │   ├── middleware.ts     # Bearer JWT + dev token auth
│   │   ├── oauth.ts          # GitHub OAuth 2.1 + PKCE server
│   │   └── jwt.ts            # JWT sign/verify
│   ├── db/
│   │   ├── schema.sql        # Source of truth for D1 schema
│   │   ├── queries.ts        # Typed query helpers
│   │   └── oauth.ts          # OAuth table queries
│   └── types.ts              # Worker types (re-exports shared.ts + adds Env)
├── types/
│   └── shared.ts             # Data types shared by Worker and frontend
├── frontend/                 # Cloudflare Pages SPA
│   ├── src/
│   │   ├── auth.ts           # Browser PKCE OAuth flow + token storage
│   │   ├── api.ts            # MCP transport abstraction
│   │   ├── App.tsx           # Root component, routing
│   │   └── views/
│   │       ├── Pantry.tsx
│   │       └── MealPlan.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── migrations/               # D1 migration files
├── test/
│   ├── mcp.test.ts           # Integration tests (vitest + @cloudflare/vitest-pool-workers)
│   ├── setup.ts              # Applies D1 migrations before each test file
│   ├── env.d.ts              # Cloudflare.Env augmentation for test bindings
│   └── tsconfig.json
├── .github/workflows/
│   ├── ci.yml                # Typecheck + test on push/PR
│   ├── deploy-prod.yml       # Worker production deploy (manual)
│   ├── deploy-pages.yml      # Frontend production deploy (manual)
│   └── deploy-staging.yml    # Sequential staging deploy: Worker then Pages (manual)
├── vitest.config.ts
├── tsconfig.json
├── wrangler.toml
└── package.json
```

---

## Commands

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Local development
npm run dev                   # Worker on http://localhost:8787
cd frontend && npm run dev    # Frontend on http://localhost:5173

# Run tests (single pass)
npm test                      # vitest run

# Run tests in watch mode
npm run test:watch            # vitest

# Type-check
npm run typecheck             # Worker + test
cd frontend && npm run typecheck  # Frontend

# Apply DB migrations locally
npm run migrate:local

# Apply DB migrations to production
npm run migrate:prod

# Deploy Worker to Cloudflare
npm run deploy

# Create a new migration file
npm run migration:new -- <name>

# Tail production logs
npm run logs
```

---

## Development workflow

- OAuth is always on (`ENABLE_OAUTH = "true"` in `wrangler.toml`). For local dev you need a GitHub OAuth App pointed at `http://localhost:8787/oauth/callback` — see SETUP.md.
- Required `.dev.vars` for full local dev:
  ```
  GITHUB_CLIENT_ID=<local oauth app client id>
  GITHUB_CLIENT_SECRET=<local oauth app client secret>
  JWT_SECRET=<any 32+ char random string>
  ALLOWED_ORIGIN=http://localhost:5173
  ```
- Optional `.dev.vars` additions for curl testing (not needed for the browser frontend):
  ```
  DEV_TOKEN=some-local-secret
  DEV_USER_ID=usr_local
  ```
- Required `frontend/.env.local`:
  ```
  VITE_WORKER_URL=http://localhost:8787
  ```
- Use `--local` flag for all D1 operations during development — this hits a local SQLite file, not the remote database.
- Automated integration tests live in `test/mcp.test.ts`. Tests use `@cloudflare/vitest-pool-workers` which runs code in a real Workers runtime (Miniflare) with an in-memory D1 database.

---

## Database schema

Canonical schema lives in `src/db/schema.sql`. Never edit D1 directly — always go through migrations so the schema stays in sync across local/prod.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- GitHub user ID (oauth sub)
  email TEXT,
  household_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  category TEXT,
  quantity REAL,
  unit TEXT,
  in_stock INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,           -- ISO date (YYYY-MM-DD)
  name TEXT NOT NULL,
  ingredients TEXT,             -- JSON-encoded MealIngredient[]
  steps TEXT,                   -- JSON-encoded string[]
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meals_household_date ON meal_plans(household_id, date);
```

---

## MCP tools

Add new tools in `src/mcp/tools/`. Each file exports a `definition` (JSON Schema) and a `handler` function.

### Pantry tools

| Tool | Description |
|------|-------------|
| `pantry_list` | List all pantry items, optionally filtered by category or in_stock status |
| `pantry_update` | Update quantity/stock status for an item (or create if new) |
| `pantry_mark_out` | Mark one or more items as out of stock |
| `pantry_bulk_update` | Update multiple items at once (e.g. after a grocery shop) |

### Meal planning tools

| Tool | Description |
|------|-------------|
| `meal_plan_get` | Get meals for a date range |
| `meal_plan_set` | Set or update meals for specific days |
| `meal_plan_delete` | Remove meals for specific days |
| `meal_plan_suggest` | (future) Suggest meals based on what's in the pantry |

---

## MCP protocol notes

- Transport: HTTP (Streamable HTTP, not SSE) — required for Cloudflare Workers
- Endpoint: `POST /mcp` — all MCP messages go here
- Auth header in prod: `Authorization: Bearer <OAuth access token>`
- Auth header for curl testing: `X-Dev-Token: <value from .dev.vars>` (requires `DEV_TOKEN` set)
- MCP version: target the latest stable spec (https://spec.modelcontextprotocol.io/specification/)

---

## Auth

GitHub OAuth 2.1 with PKCE. The Worker acts as both an OAuth server (to Claude.ai and the browser) and an OAuth client (to GitHub).

### Flow

1. Client discovers auth endpoints via `GET /.well-known/oauth-authorization-server` (RFC 8414)
2. Client hits `GET /authorize` → Worker redirects to GitHub OAuth
3. GitHub redirects to `GET /oauth/callback` → Worker exchanges code for GitHub token, looks up or creates user, issues a short-lived MCP auth code
4. Worker redirects to the client's `redirect_uri` with the auth code
5. Client POSTs to `POST /token` with the auth code + PKCE verifier → Worker returns a signed JWT
6. Client uses the JWT as `Authorization: Bearer` on MCP requests; refreshes proactively 5 min before expiry

### Endpoints

| Path | Purpose |
|------|---------|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 resource metadata |
| `POST /register` | Dynamic Client Registration (RFC 7591) |
| `GET /authorize` | Starts GitHub redirect |
| `POST /token` | Issues JWT for auth code or refresh token |
| `GET /oauth/callback` | GitHub OAuth callback |

### Token refresh

Returns `invalid_grant` (RFC 6749) when a refresh token is expired or invalid, so clients restart the auth flow rather than retrying indefinitely.

---

## Environment variables

### `.dev.vars` (local only, gitignored)

```
GITHUB_CLIENT_ID=<local oauth app>
GITHUB_CLIENT_SECRET=<local oauth app>
JWT_SECRET=<32+ char random string>
ALLOWED_ORIGIN=http://localhost:5173

# Optional — enable dev token auth (curl + frontend VITE_DEV_TOKEN):
ENABLE_DEV_AUTH=true
DEV_TOKEN=some-local-secret
DEV_USER_ID=usr_local
```

### `frontend/.env.local` (gitignored)

```
VITE_WORKER_URL=http://localhost:8787
```

### Production secrets (set via `wrangler secret put <NAME>`)

```
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
JWT_SECRET
```

### `wrangler.toml` vars (non-secret, committed)

```
ENABLE_OAUTH = "true"
ALLOWED_ORIGIN = "https://grocery-store-frontend.pages.dev"
```

---

## Coding conventions

- TypeScript strict mode on
- No `any` — use `unknown` and narrow explicitly
- Shared data types go in `types/shared.ts`; Worker-specific types in `src/types.ts`
- D1 queries go in `src/db/queries.ts` — no inline SQL elsewhere
- Each MCP tool handler is a pure async function: `(args, env, userId) => Promise<ToolResult>`
- Errors returned as MCP error responses, not thrown (Workers have no uncaught handler)
- Dates stored as Unix timestamps (integers) in D1; ISO date strings (`YYYY-MM-DD`) in MCP responses

---

## Useful references

- [MCP specification](https://spec.modelcontextprotocol.io/specification/)
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 docs](https://developers.cloudflare.com/d1/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
