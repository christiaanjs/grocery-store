# Phase 1 — curl-testable MCP server

## Scaffolding
- [x] `.gitignore` — exclude `node_modules/`, `.dev.vars`, `.wrangler/`
- [x] `tsconfig.json` — TypeScript config targeting Workers
- [x] `npm install`

## Database
- [x] `wrangler d1 create grocery-store-db` — paste returned ID into `wrangler.toml`

## Source files
- [x] `src/types.ts` — shared TypeScript types
- [x] `src/db/schema.sql` — canonical schema (already designed in CLAUDE.md)
- [x] Initial migration — `npm run migration:new -- init-schema`, paste schema, apply locally
- [x] `src/db/queries.ts` — typed D1 query helpers
- [x] `src/auth/middleware.ts` — dev token check (`X-Dev-Token`)
- [x] `src/mcp/server.ts` — MCP protocol handler (initialize + tools/call)
- [x] `src/mcp/tools/pantry.ts` — pantry tool definitions and handlers
- [x] `src/mcp/tools/meals.ts` — meal planning tool definitions and handlers
- [x] `src/index.ts` — request router

## Verify
- [x] `.dev.vars` with `DEV_TOKEN` and `DEV_USER_ID`
- [x] `npm run dev` + curl the MCP endpoint to confirm tools work
