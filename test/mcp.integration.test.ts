/**
 * Integration tests for the AI + Vectorize semantic search pipeline.
 *
 * Run with:
 *   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> npm run test:integration
 *
 * WARNING: These tests write to the production Vectorize index (meal-embeddings) by default.
 * To avoid polluting production data, prefer running against the staging environment.
 * Staging requires: a separate Vectorize index (meal-embeddings-staging) and the staging
 * wrangler environment. See vitest.integration.config.ts for configuration.
 *
 * The test vector (date: 2099-12-25) is cleaned up in afterAll. If a test run is
 * interrupted before cleanup, the orphan vector is harmless but can be removed manually
 * with: wrangler vectorize delete-by-ids meal-embeddings --ids="<household_id>:2099-12-25"
 *
 * D1 is in-memory (fresh each run); AI and Vectorize hit real Cloudflare services.
 *
 * Vectorize has eventual consistency — a freshly-upserted vector may not appear in
 * query results immediately. meal_search handles this gracefully via a keyword
 * fallback, so search tests are reliable even if the vector isn't indexed yet.
 */
import { SELF } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";

// No vi.spyOn mocks — bindings call real Cloudflare Workers AI and Vectorize.

const TOKEN = "test-token";
const DATE = "2099-12-25"; // Far-future date; won't conflict with real household data
// Separate date for the semantic-only test so cleanup is clear
const SEMANTIC_DATE = "2099-11-11";

type McpResponse = {
  jsonrpc: string;
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

async function call(id: number, tool: string, args: Record<string, unknown> = {}): Promise<McpResponse> {
  const httpRes = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-Token": TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  if (!httpRes.ok) {
    const body = await httpRes.text();
    throw new Error(`HTTP ${httpRes.status} from ${tool}: ${body.slice(0, 500)}`);
  }
  const json = await httpRes.json() as McpResponse;
  if (json.error) {
    throw new Error(`MCP error from ${tool}: code=${json.error.code} message=${json.error.message}`);
  }
  if (!json.result) {
    throw new Error(`No result from ${tool} (full response: ${JSON.stringify(json).slice(0, 500)})`);
  }
  return json;
}

// Returns the first content text or throws with the tool error text if isError is set.
async function resultText(id: number, tool: string, args?: Record<string, unknown>): Promise<string> {
  const res = await call(id, tool, args);
  const content = res.result?.["content"] as Array<{ type: string; text: string }> | undefined;
  const text = content?.[0]?.text ?? "";
  if (res.result?.["isError"]) {
    throw new Error(`Tool ${tool} returned isError: ${text}`);
  }
  return text;
}

// Like resultText but parses JSON and throws a descriptive error if parsing fails.
async function resultJson<T>(id: number, tool: string, args?: Record<string, unknown>): Promise<T> {
  const text = await resultText(id, tool, args);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${tool} returned non-JSON (first 500 chars): ${text.slice(0, 500)}`);
  }
}

describe("AI + Vectorize integration", () => {
  afterAll(async () => {
    // Remove test meal entries and their vectors from the real Vectorize index.
    // Best-effort — don't throw if this fails.
    try {
      await resultText(999, "meal_plan_delete", { dates: [DATE, SEMANTIC_DATE] });
    } catch { /* ignore */ }
  });

  it("meal_plan_set embeds meal into Vectorize without error", async () => {
    const entries = await resultJson<Array<{ date: string; name: string }>>(1, "meal_plan_set", {
      meals: [
        {
          date: DATE,
          name: "roasted chicken with rosemary",
          ingredients: [
            { name: "chicken", quantity: 1, unit: "whole" },
            { name: "rosemary", quantity: 2, unit: "sprigs" },
            { name: "garlic", quantity: 4, unit: "cloves" },
          ],
        },
      ],
    });
    expect(entries[0]?.name).toBe("roasted chicken with rosemary");
  });

  it("meal_plan_set upserts a vector that semantic search can actually find", async () => {
    // This test verifies the Vectorize write path end-to-end.
    //
    // The meal name and ingredients are chosen so that no word in the search query
    // appears anywhere in the stored meal text — the keyword fallback in meal_search
    // cannot return this meal, so a positive result proves the Vectorize vector was
    // indexed and the query embedding matched it.
    //
    //   Stored:  "INTTEST_SEMANTIC_MEAL" — ground turkey, cumin, paprika, black beans
    //   Query:   "spicy Tex-Mex burrito filling"
    //   Overlap: none (keyword search does whole-query substring match on name + ingredients JSON)
    //
    // Vectorize has eventual consistency, so we poll until the vector appears or 60 s elapses.
    await resultJson(10, "meal_plan_set", {
      meals: [{
        date: SEMANTIC_DATE,
        name: "INTTEST_SEMANTIC_MEAL",
        ingredients: [
          { name: "ground turkey" },
          { name: "cumin" },
          { name: "paprika" },
          { name: "black beans" },
        ],
      }],
    });

    const TIMEOUT_MS = 60_000;
    const INTERVAL_MS = 5_000;
    const start = Date.now();
    let found = false;

    while (Date.now() - start < TIMEOUT_MS) {
      const results = await resultJson<Array<{ date: string }>>(11, "meal_search", {
        query: "spicy Tex-Mex burrito filling",
      });
      if (results.some((r) => r.date === SEMANTIC_DATE)) {
        found = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }

    expect(found, "Vectorize did not index the vector within 60 s — the upsert may have failed").toBe(true);
  }, 75_000); // 75 s test timeout; the poll loop runs up to 60 s

  it("meal_search finds the meal via semantic or keyword fallback path", async () => {
    // Semantic path: Workers AI embeds the query → Vectorize query. If the vector
    // isn't indexed yet (eventual consistency), the keyword fallback catches it.
    const results = await resultJson<Array<{ name: string }>>(2, "meal_search", { query: "chicken" });
    expect(results.some((r) => r.name === "roasted chicken with rosemary")).toBe(true);
  });

  it("meal_plan_suggest returns a response without error", async () => {
    // Add an in-stock ingredient so the tool has a pantry query to embed.
    await resultJson(3, "pantry_update", { name: "chicken", in_stock: true });

    // May return suggestions (if Vectorize has indexed) or [] (if not yet visible due to
    // eventual consistency) — both are valid JSON arrays, neither is a tool error.
    const suggestions = await resultJson<unknown[]>(4, "meal_plan_suggest", {});
    expect(Array.isArray(suggestions)).toBe(true);
  });
});
