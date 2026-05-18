/**
 * Integration tests for the AI + Vectorize semantic search pipeline.
 *
 * Run with:
 *   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> npm run test:integration
 *
 * D1 is in-memory (fresh each run); AI and Vectorize hit real Cloudflare services.
 * Vectors written here are cleaned up in afterAll via meal_plan_delete.
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

async function call(id: number, tool: string, args: Record<string, unknown> = {}) {
  const res = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-Token": TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  return res.json() as Promise<{
    jsonrpc: string;
    id: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }>;
}

async function resultText(id: number, tool: string, args?: Record<string, unknown>) {
  const res = await call(id, tool, args);
  const content = res.result?.["content"] as Array<{ type: string; text: string }> | undefined;
  return content?.[0]?.text ?? "";
}

describe("AI + Vectorize integration", () => {
  afterAll(async () => {
    // Remove the test meal entry and its vector from the real Vectorize index.
    await resultText(999, "meal_plan_delete", { dates: [DATE] });
  });

  it("meal_plan_set embeds meal into Vectorize without error", async () => {
    const text = await resultText(1, "meal_plan_set", {
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
    const entries = JSON.parse(text) as Array<{ date: string; name: string }>;
    expect(entries[0]?.name).toBe("roasted chicken with rosemary");
  });

  it("meal_search finds the meal via semantic or keyword fallback path", async () => {
    // Semantic path: Workers AI embeds the query → Vectorize query. If the vector
    // isn't indexed yet (eventual consistency), the keyword fallback catches it.
    const text = await resultText(2, "meal_search", { query: "chicken" });
    const results = JSON.parse(text) as Array<{ name: string }>;
    expect(results.some((r) => r.name === "roasted chicken with rosemary")).toBe(true);
  });

  it("meal_plan_suggest returns a response without error", async () => {
    // Add an in-stock ingredient so the tool has a pantry query to embed.
    await resultText(3, "pantry_update", { name: "chicken", in_stock: true });
    const res = await call(4, "meal_plan_suggest", {});
    // May return meal suggestions (if Vectorize has indexed) or "No past meals found"
    // (if the vector isn't visible yet) — both are valid, neither is an error.
    expect(res.result?.["isError"]).toBeUndefined();
    const content = res.result?.["content"] as Array<{ type: string; text: string }>;
    expect(content?.[0]?.text).toBeTruthy();
  });
});
