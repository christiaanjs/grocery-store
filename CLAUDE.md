# Grocery Store — Claude Code Guide

## Current status

**Phase 1 complete.** Core MCP server is implemented and tested locally. Auth uses a hardcoded dev token (`X-Dev-Token`). OAuth (Phase 2) is not yet implemented — Claude.ai integration requires it.

---

## Project overview

A remote MCP server that gives Claude persistent memory for weekly dinner planning.
Core features: pantry/grocery tracking (what's in stock, what's run out), meal planning for the week.

**Stack:**
- Cloudflare Worker (MCP server + OAuth 2.1)
- Cloudflare D1 (SQLite — pantry, meal plans, users)
- TypeScript throughout
- Wrangler for local dev and deployment
- GitHub Actions for CI/CD

---

## Repository structure

```
/
├── src/
│   ├── index.ts          # Worker entry point — request routing
│   ├── mcp/
│   │   ├── server.ts     # MCP protocol handler
│   │   └── tools/        # One file per MCP tool
│   │       ├── pantry.ts
│   │       └── meals.ts
│   ├── auth/
│   │   └── middleware.ts # Auth checks — dev token now, OAuth Phase 2
│   ├── db/
│   │   ├── schema.sql    # Source of truth for D1 schema
│   │   └── queries.ts    # Typed query helpers
│   └── types.ts          # Shared TypeScript types
├── migrations/           # D1 migration files (wrangler d1 migrations create)
├── test/
│   ├── mcp.test.ts       # Integration tests (vitest + @cloudflare/vitest-pool-workers)
│   ├── setup.ts          # Applies D1 migrations before each test file
│   ├── env.d.ts          # Cloudflare.Env augmentation for test bindings
│   └── tsconfig.json     # Extends root tsconfig, adds workers/vitest types
├── .github/workflows/
│   └── ci.yml            # Typecheck + test on push/PR
├── vitest.config.ts
├── tsconfig.json
├── wrangler.toml
├── package.json
└── CLAUDE.md             # This file
```

---

## Commands

```bash
# Install dependencies
npm install

# Local development (Worker + D1 local)
npm run dev               # wrangler dev

# Run tests (single pass)
npm test                  # vitest run

# Run tests in watch mode
npm run test:watch        # vitest

# Type-check (src + test)
npm run typecheck         # tsc --noEmit && tsc --noEmit -p test/tsconfig.json

# Apply DB migrations locally
npm run migrate:local     # wrangler d1 migrations apply grocery-store-db --local

# Apply DB migrations to production
npm run migrate:prod      # wrangler d1 migrations apply grocery-store-db --remote

# Deploy to Cloudflare
npm run deploy            # wrangler deploy

# Create a new migration file
npm run migration:new -- <name>   # wrangler d1 migrations create grocery-store-db <name>

# Tail production logs
npm run logs              # wrangler tail
```

---

## Development workflow

- During early development, auth is bypassed with a hardcoded `X-Dev-Token` header
  checked in `auth/middleware.ts`. OAuth is added last.
- Use `--local` flag for all D1 operations during development — this hits a local SQLite
  file, not the remote database.
- The MCP server can be tested manually using curl against `http://localhost:8787`.
- Automated integration tests live in `test/mcp.test.ts` — run with `npm test`. Tests use
  `@cloudflare/vitest-pool-workers` which runs code in a real Workers runtime (Miniflare)
  with an in-memory D1 database. Migrations are applied automatically via `test/setup.ts`.

---

## Database schema

Canonical schema lives in `src/db/schema.sql`. Never edit D1 directly — always go through
migrations so the schema stays in sync across local/prod.

```sql
-- src/db/schema.sql (for reference — apply via migrations)

CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- GitHub user ID (oauth sub)
  email TEXT,
  household_id TEXT NOT NULL,   -- allows shared pantry (e.g. you + Ruby)
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
  category TEXT,                -- 'produce', 'dairy', 'pantry', etc.
  quantity REAL,
  unit TEXT,                    -- 'g', 'ml', 'count', etc.
  in_stock INTEGER NOT NULL DEFAULT 1,  -- 0 = run out
  updated_at INTEGER NOT NULL
);

CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  week_start TEXT NOT NULL,     -- ISO date, Monday of the week
  meals TEXT NOT NULL,          -- JSON blob: { mon: {...}, tue: {...}, ... }
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meals_household_week ON meal_plans(household_id, week_start);
```

---

## MCP tools

These are the tools exposed to Claude. Add new tools in `src/mcp/tools/`.
Each tool file exports a `definition` (JSON Schema) and a `handler` function.

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
| `meal_plan_get` | Get the meal plan for a given week (defaults to current week) |
| `meal_plan_set` | Set or update meals for specific days |
| `meal_plan_suggest` | (future) Suggest meals based on what's in the pantry |

---

## MCP protocol notes

- Transport: HTTP (Streamable HTTP, not SSE) — required for Cloudflare Workers
- Endpoint: `POST /mcp` — all MCP messages go here
- Auth header during dev (curl only): `X-Dev-Token: <value from .dev.vars>`
- Auth header in prod: `Authorization: Bearer <OAuth access token>`
- Claude.ai always uses OAuth — it never sends custom headers like `X-Dev-Token`
- MCP version: target the latest stable spec (https://spec.modelcontextprotocol.io/specification/)

Cloudflare Workers do not support long-lived SSE connections reliably — use the
Streamable HTTP transport, not the SSE transport.

---

## Auth plan

**Phase 1 (now):** Hardcoded dev token for curl-based testing only.
Set `DEV_TOKEN` in `.dev.vars` and `DEV_USER_ID` to your user ID.
The middleware skips OAuth if the `X-Dev-Token` header matches.

> **Note:** Claude.ai always uses OAuth — static bearer tokens are not supported.
> `X-Dev-Token` is only useful for direct curl testing, not for testing with Claude.ai.
> To test end-to-end with Claude.ai, OAuth must be implemented.

**Phase 2 (later):** GitHub OAuth 2.1 with PKCE. The MCP server acts as both an OAuth
server to Claude.ai and an OAuth client to GitHub (third-party auth flow — explicitly
supported by the MCP spec).

### Auth type

Claude supports five auth types. Use **`oauth_dcr`** (Dynamic Client Registration) —
it's available without any approval process and is the simplest path.
Note: DCR registers a new client on every fresh connection; for a personal server this
is acceptable.

### Full OAuth flow

1. Claude.ai discovers auth endpoints via `GET /.well-known/oauth-authorization-server`
   (RFC8414 metadata doc). **Required** — without it Claude.ai falls back to `/authorize`
   and `/token` at the domain root.
2. Claude.ai hits `GET /authorize` → Worker redirects user to GitHub OAuth
3. GitHub redirects to `GET /oauth/callback` → Worker exchanges code for GitHub token,
   looks up or creates user, issues a short-lived MCP auth code
4. Worker redirects to **`https://claude.ai/api/mcp/auth_callback`** with the MCP auth
   code. This is Claude.ai's fixed callback URL — the Worker must redirect here, not
   back to a custom URL.
5. Claude.ai posts to `POST /token` with the MCP auth code + PKCE verifier → Worker
   validates and returns a signed JWT (via `crypto.subtle`)
6. Claude.ai uses the JWT as `Authorization: Bearer` on all MCP requests; refreshes
   proactively 5 min before expiry and reactively on 401

### Required OAuth endpoints

| Endpoint | Path | Purpose |
|----------|------|---------|
| Metadata discovery | `GET /.well-known/oauth-authorization-server` | Advertises all other endpoints |
| Authorization | `GET /authorize` | Starts GitHub redirect |
| Token exchange | `POST /token` | Issues MCP JWT for auth code; handles refresh |
| Registration | `POST /register` | DCR — Claude registers itself automatically |

### Token refresh

When a refresh token is invalid or expired, return an RFC 6749-compliant error
(`invalid_grant`) rather than a generic 400/401, so Claude.ai knows to restart the
auth flow rather than retry indefinitely.

Keep OAuth behind a feature flag (`ENABLE_OAUTH=true` in `wrangler.toml`) so it can
be built without breaking Phase 1 curl testing.

---

## Environment variables

Stored in `.dev.vars` locally (gitignored), and Cloudflare secrets in prod.

```
# .dev.vars (local only, never commit)
DEV_TOKEN=some-local-secret
DEV_USER_ID=usr_local

# Production secrets (set via: wrangler secret put <NAME>)
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
JWT_SECRET
```

Non-secret config goes in `wrangler.toml` under `[vars]`.

---

## Coding conventions

- TypeScript strict mode on
- No `any` — use `unknown` and narrow explicitly
- D1 queries go in `src/db/queries.ts` — no inline SQL elsewhere
- Each MCP tool handler is a pure async function: `(args, env, userId) => Promise<ToolResult>`
- Errors returned as MCP error responses, not thrown (Workers have no uncaught handler)
- Dates stored as Unix timestamps (integers) in D1; ISO strings in MCP responses

---

## Useful references

- [MCP specification](https://spec.modelcontextprotocol.io/specification/)
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 docs](https://developers.cloudflare.com/d1/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
