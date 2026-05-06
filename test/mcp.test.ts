import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const TOKEN = "test-token";

async function mcp(id: number, method: string, params?: unknown) {
  const res = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-Token": TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }),
  });
  return res.json() as Promise<{
    jsonrpc: string;
    id: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }>;
}

async function call(id: number, tool: string, args: Record<string, unknown> = {}) {
  return mcp(id, "tools/call", { name: tool, arguments: args });
}

async function resultText(id: number, tool: string, args?: Record<string, unknown>) {
  const res = await call(id, tool, args);
  const content = res.result?.["content"] as Array<{ type: string; text: string }> | undefined;
  return content?.[0]?.text ?? "";
}

// ── Auth ──────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("returns 401 without token", async () => {
    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await SELF.fetch("http://localhost/unknown");
    expect(res.status).toBe(404);
  });
});

// ── Initialize ────────────────────────────────────────────────────────────

describe("initialize", () => {
  it("returns server info and protocol version", async () => {
    const res = await mcp(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(res.result?.["serverInfo"]).toMatchObject({ name: "grocery-store" });
    expect(res.result?.["protocolVersion"]).toBe("2024-11-05");
    expect(res.result?.["capabilities"]).toMatchObject({ tools: {} });
  });
});

// ── Tools list ────────────────────────────────────────────────────────────

describe("tools/list", () => {
  it("returns all tools", async () => {
    const res = await mcp(2, "tools/list");
    const names = (res.result?.["tools"] as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual([
      "pantry_list",
      "pantry_update",
      "pantry_mark_out",
      "pantry_bulk_update",
      "meal_plan_get",
      "meal_plan_set",
    ]);
  });

  it("returns error for unknown method", async () => {
    const res = await mcp(3, "unknown/method");
    expect(res.error?.code).toBe(-32601);
  });
});

// ── Pantry ────────────────────────────────────────────────────────────────

describe("pantry", () => {
  it("lists empty pantry on first call", async () => {
    const text = await resultText(10, "pantry_list");
    expect(JSON.parse(text)).toEqual([]);
  });

  it("creates an item via pantry_update", async () => {
    const text = await resultText(11, "pantry_update", {
      name: "eggs",
      category: "dairy",
      quantity: 12,
      unit: "count",
    });
    const item = JSON.parse(text) as Record<string, unknown>;
    expect(item["name"]).toBe("eggs");
    expect(item["category"]).toBe("dairy");
    expect(item["quantity"]).toBe(12);
    expect(item["in_stock"]).toBe(1);
  });

  it("lists the created item", async () => {
    const text = await resultText(12, "pantry_list");
    const items = JSON.parse(text) as Array<{ name: string }>;
    expect(items.some((i) => i.name === "eggs")).toBe(true);
  });

  it("bulk-adds items", async () => {
    const text = await resultText(13, "pantry_bulk_update", {
      items: [
        { name: "milk", category: "dairy", quantity: 2, unit: "L" },
        { name: "olive oil", category: "pantry", quantity: 500, unit: "ml" },
      ],
    });
    expect(text).toBe("Updated 2 item(s)");
  });

  it("filters by category", async () => {
    const text = await resultText(14, "pantry_list", { category: "pantry" });
    const items = JSON.parse(text) as Array<{ name: string }>;
    expect(items.every((i) => i.name === "olive oil")).toBe(true);
  });

  it("marks an item as out of stock", async () => {
    const text = await resultText(15, "pantry_mark_out", { names: ["milk"] });
    expect(text).toBe("Marked 1 item(s) as out of stock");
  });

  it("filters to only out-of-stock items", async () => {
    const text = await resultText(16, "pantry_list", { in_stock: false });
    const items = JSON.parse(text) as Array<{ name: string; in_stock: number }>;
    expect(items.length).toBe(1);
    expect(items[0]?.name).toBe("milk");
    expect(items[0]?.in_stock).toBe(0);
  });

  it("returns error when pantry_update called without name", async () => {
    const res = await call(17, "pantry_update", { quantity: 5 });
    const content = res.result?.["content"] as Array<{ type: string; text: string }>;
    expect(res.result?.["isError"]).toBe(true);
    expect(content?.[0]?.text).toContain("name is required");
  });
});

// ── Meal plans ────────────────────────────────────────────────────────────

describe("meal plans", () => {
  const WEEK = "2026-05-04";

  it("returns message when no plan exists", async () => {
    const text = await resultText(20, "meal_plan_get", { week_start: WEEK });
    expect(text).toContain("No meal plan found");
  });

  it("sets meals for a week", async () => {
    const text = await resultText(21, "meal_plan_set", {
      week_start: WEEK,
      meals: { mon: "pasta", tue: "stir fry", wed: "soup" },
    });
    const plan = JSON.parse(text) as { week_start: string; meals: Record<string, string> };
    expect(plan.week_start).toBe(WEEK);
    expect(plan.meals["mon"]).toBe("pasta");
    expect(plan.meals["tue"]).toBe("stir fry");
  });

  it("retrieves the meal plan", async () => {
    const text = await resultText(22, "meal_plan_get", { week_start: WEEK });
    const plan = JSON.parse(text) as { meals: Record<string, string> };
    expect(plan.meals["mon"]).toBe("pasta");
  });

  it("merges a partial update", async () => {
    await resultText(23, "meal_plan_set", {
      week_start: WEEK,
      meals: { thu: "tacos", fri: "pizza" },
    });
    const text = await resultText(24, "meal_plan_get", { week_start: WEEK });
    const plan = JSON.parse(text) as { meals: Record<string, string> };
    expect(plan.meals["mon"]).toBe("pasta");
    expect(plan.meals["thu"]).toBe("tacos");
    expect(plan.meals["fri"]).toBe("pizza");
  });
});
