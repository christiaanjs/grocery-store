# Grocery Store

A remote [MCP](https://spec.modelcontextprotocol.io/specification/) server that gives Claude persistent memory for weekly dinner planning. Track what's in your pantry, what's run out, and plan meals for the week — all from a Claude conversation.

Built on Cloudflare Workers + D1 (SQLite).

---

## What it does

Claude gets seven tools:

| Tool | What it does |
|------|-------------|
| `pantry_list` | List pantry items, filter by category or stock status |
| `pantry_update` | Update quantity/stock for an item (creates if new) |
| `pantry_mark_out` | Mark one or more items as out of stock |
| `pantry_bulk_update` | Update multiple items at once (e.g. after a grocery run) |
| `meal_plan_get` | Get the meal plan for a given week |
| `meal_plan_set` | Set or update meals for specific days |

Example conversation:
> "We're out of olive oil and eggs. Plan dinners for this week using what we have."

---

## Architecture

```
Claude.ai  ──(OAuth)──▶  Cloudflare Worker  ──▶  D1 (SQLite)
                              │
                         MCP over HTTP
                        (Streamable HTTP transport)
```

- **Transport:** Streamable HTTP (not SSE — Workers don't support long-lived connections)
- **Auth:** Dev token for local testing; GitHub OAuth 2.1 + PKCE for Claude.ai (Phase 2)
- **Database:** Cloudflare D1 with households, users, pantry items, and meal plans

---

## Getting started

### Prerequisites

- Node.js 22+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler authenticated: `npx wrangler login`

### Local development

```bash
npm install

# Create the D1 database (first time only)
npx wrangler d1 create grocery-store-db
# Copy the database_id into wrangler.toml

# Create .dev.vars with your local credentials
cat > .dev.vars <<EOF
DEV_TOKEN=some-local-secret
DEV_USER_ID=usr_local
EOF

# Apply migrations and start the dev server
npm run migrate:local
npm run dev
```

Test it:
```bash
curl -s http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "X-Dev-Token: some-local-secret" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Tests

```bash
npm test           # single pass
npm run test:watch # watch mode
npm run typecheck  # type-check src + test
```

Tests run in a real Workers runtime (Miniflare) with an in-memory D1 database — no network, no Cloudflare account needed.

### Deploy

```bash
npm run deploy

# Set production secrets
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
```

See [SETUP.md](./SETUP.md) for the full bootstrap guide including GitHub OAuth App registration and Claude.ai connector setup.

---

## Project structure

```
src/
  index.ts              # Worker entry point
  mcp/
    server.ts           # MCP protocol handler (JSON-RPC 2.0)
    tools/
      pantry.ts         # Pantry tool definitions + handlers
      meals.ts          # Meal planning tool definitions + handlers
  auth/
    middleware.ts        # Auth — dev token now, OAuth Phase 2
  db/
    schema.sql          # Canonical D1 schema
    queries.ts          # Typed query helpers
  types.ts              # Shared types
migrations/             # Wrangler D1 migration files
test/
  mcp.test.ts           # Integration tests (17 tests)
```

---

## Roadmap

- [x] Phase 1 — Core MCP server with pantry + meal planning tools
- [ ] Phase 2 — GitHub OAuth 2.1 (required for Claude.ai integration)
- [ ] Phase 3 — `meal_plan_suggest` tool (suggest meals from pantry contents)
