# Grocery Store

A remote [MCP](https://spec.modelcontextprotocol.io/specification/) server that gives Claude persistent memory for weekly dinner planning. Track what's in your pantry, what's run out, and plan meals for the week — all from a Claude conversation or the browser UI.

Built on Cloudflare Workers + D1 (SQLite) + Cloudflare Pages.

---

## What it does

Claude gets seven tools:

| Tool | What it does |
|------|-------------|
| `pantry_list` | List pantry items, filter by category or stock status |
| `pantry_update` | Update quantity/stock for an item (creates if new) |
| `pantry_mark_out` | Mark one or more items as out of stock |
| `pantry_bulk_update` | Update multiple items at once (e.g. after a grocery run) |
| `meal_plan_get` | Get meals for a date range |
| `meal_plan_set` | Set or update meals for specific days |
| `meal_plan_delete` | Remove meals for specific days |

The browser frontend provides the same functionality with a pantry table and a drag-and-drop meal calendar.

Example conversation:
> "We're out of olive oil and eggs. Plan dinners for this week using what we have."

---

## Architecture

```
Claude.ai  ──(OAuth)──▶  Cloudflare Worker  ──▶  D1 (SQLite)
                              ▲
Browser UI ──(OAuth)──────────┘
(Cloudflare Pages)
        MCP over HTTP (Streamable HTTP transport)
```

- **Transport:** Streamable HTTP (not SSE — Workers don't support long-lived connections)
- **Auth:** GitHub OAuth 2.1 + PKCE; browser uses Dynamic Client Registration
- **Database:** Cloudflare D1 with households, users, pantry items, and meal plans

---

## Getting started

See [SETUP.md](./SETUP.md) for the full bootstrap guide.

Quick start for local dev:

```bash
npm install
cd frontend && npm install && cd ..
npm run migrate:local

# Terminal 1
npm run dev

# Terminal 2
cd frontend && npm run dev
```

You'll need a GitHub OAuth App and a few secrets in `.dev.vars` and `frontend/.env.local` — see SETUP.md step 2–4.

### Tests

```bash
npm test           # single pass
npm run test:watch # watch mode
npm run typecheck  # type-check Worker + test
cd frontend && npm run typecheck  # type-check frontend
```

---

## Project structure

```
src/                        # Cloudflare Worker
  index.ts                  # Entry point, routing, CORS
  mcp/
    server.ts               # MCP protocol handler (JSON-RPC 2.0)
    tools/
      pantry.ts             # Pantry tool definitions + handlers
      meals.ts              # Meal planning tool definitions + handlers
  auth/
    middleware.ts           # Bearer JWT + dev token auth
    oauth.ts                # GitHub OAuth 2.1 + PKCE server
    jwt.ts                  # JWT sign/verify
  db/
    schema.sql              # Canonical D1 schema
    queries.ts              # Typed query helpers
    oauth.ts                # OAuth table queries
  types.ts                  # Worker types (re-exports shared types + Env)
types/
  shared.ts                 # Data types shared between Worker and frontend
frontend/                   # Cloudflare Pages SPA (Preact + Vite)
  src/
    auth.ts                 # Browser PKCE OAuth flow
    api.ts                  # MCP transport abstraction
    App.tsx                 # Root component, routing
    views/
      Pantry.tsx            # Pantry table view
      MealPlan.tsx          # FullCalendar meal plan view
migrations/                 # Wrangler D1 migration files
test/                       # Integration tests (Miniflare + Vitest)
.github/workflows/
  ci.yml                    # Typecheck + test on push/PR
  deploy-prod.yml           # Worker production deploy (manual)
  deploy-pages.yml          # Frontend production deploy (manual)
  deploy-staging.yml        # Sequential staging deploy: Worker then Pages (manual)
```

---

## Roadmap

- [x] Phase 1 — Core MCP server with pantry + meal planning tools
- [x] Phase 2 — GitHub OAuth 2.1 + browser frontend
- [ ] Phase 3 — `meal_plan_suggest` tool (suggest meals from pantry contents)
