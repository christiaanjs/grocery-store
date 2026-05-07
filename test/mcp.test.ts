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
      "meal_plan_delete",
      "preferences_list",
      "preferences_set",
      "preferences_delete",
      "meal_feedback_set",
      "meal_search",
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
  const WEEK = "2026-05-04"; // Monday
  const MON = "2026-05-04";
  const TUE = "2026-05-05";
  const WED = "2026-05-06";
  const THU = "2026-05-07";
  const FRI = "2026-05-08";

  it("returns message when no entries exist", async () => {
    const text = await resultText(20, "meal_plan_get", { week_start: WEEK });
    expect(text).toContain("No meals found");
  });

  it("sets a single meal with name only", async () => {
    const text = await resultText(21, "meal_plan_set", {
      meals: [{ date: MON, name: "pasta" }],
    });
    const entries = JSON.parse(text) as Array<{ date: string; name: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.date).toBe(MON);
    expect(entries[0]?.name).toBe("pasta");
  });

  it("sets multiple meals with ingredients and steps", async () => {
    const text = await resultText(22, "meal_plan_set", {
      meals: [
        {
          date: TUE,
          name: "stir fry",
          ingredients: [{ name: "tofu", quantity: 400, unit: "g" }],
          steps: ["Press tofu", "Fry vegetables", "Combine"],
        },
        { date: WED, name: "soup" },
      ],
    });
    const entries = JSON.parse(text) as Array<{
      date: string;
      name: string;
      ingredients?: Array<{ name: string }>;
      steps?: string[];
    }>;
    expect(entries).toHaveLength(2);
    const tue = entries.find((e) => e.date === TUE);
    expect(tue?.name).toBe("stir fry");
    expect(tue?.ingredients?.[0]?.name).toBe("tofu");
    expect(tue?.steps).toHaveLength(3);
  });

  it("retrieves by week_start", async () => {
    const text = await resultText(23, "meal_plan_get", { week_start: WEEK });
    const entries = JSON.parse(text) as Array<{ date: string; name: string }>;
    expect(entries.some((e) => e.date === MON && e.name === "pasta")).toBe(true);
    expect(entries.some((e) => e.date === TUE && e.name === "stir fry")).toBe(true);
    expect(entries.some((e) => e.date === WED && e.name === "soup")).toBe(true);
  });

  it("retrieves a single day", async () => {
    const text = await resultText(24, "meal_plan_get", { date: TUE });
    const entries = JSON.parse(text) as Array<{ date: string; name: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.date).toBe(TUE);
  });

  it("retrieves an arbitrary date range", async () => {
    const text = await resultText(25, "meal_plan_get", { date_from: TUE, date_to: WED });
    const entries = JSON.parse(text) as Array<{ date: string }>;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.date).sort()).toEqual([TUE, WED]);
  });

  it("upserts — updating an existing entry", async () => {
    await resultText(26, "meal_plan_set", {
      meals: [{ date: MON, name: "updated pasta", steps: ["Boil water", "Cook pasta"] }],
    });
    const text = await resultText(27, "meal_plan_get", { date: MON });
    const entries = JSON.parse(text) as Array<{ name: string; steps?: string[] }>;
    expect(entries[0]?.name).toBe("updated pasta");
    expect(entries[0]?.steps).toHaveLength(2);
  });

  it("adds more days without affecting existing ones", async () => {
    await resultText(28, "meal_plan_set", {
      meals: [
        { date: THU, name: "tacos" },
        { date: FRI, name: "pizza" },
      ],
    });
    const text = await resultText(29, "meal_plan_get", { week_start: WEEK });
    const entries = JSON.parse(text) as Array<{ date: string; name: string }>;
    expect(entries.some((e) => e.date === WED && e.name === "soup")).toBe(true);
    expect(entries.some((e) => e.date === THU && e.name === "tacos")).toBe(true);
    expect(entries.some((e) => e.date === FRI && e.name === "pizza")).toBe(true);
  });

  it("deletes specific entries", async () => {
    const text = await resultText(30, "meal_plan_delete", { dates: [WED, THU] });
    expect(text).toContain("Deleted 2");
    const remaining = await resultText(31, "meal_plan_get", { week_start: WEEK });
    const entries = JSON.parse(remaining) as Array<{ date: string }>;
    expect(entries.every((e) => e.date !== WED && e.date !== THU)).toBe(true);
  });

  it("returns error when meals is missing", async () => {
    const res = await call(32, "meal_plan_set", {});
    expect(res.result?.["isError"]).toBe(true);
  });

  it("returns error when a meal entry is missing date or name", async () => {
    const res = await call(33, "meal_plan_set", { meals: [{ date: MON }] });
    expect(res.result?.["isError"]).toBe(true);
  });
});

// ── Preferences ───────────────────────────────────────────────────────────

describe("preferences", () => {
  it("returns message when no preferences are set", async () => {
    const text = await resultText(40, "preferences_list");
    expect(text).toContain("No preferences set");
  });

  it("sets a new preference", async () => {
    const text = await resultText(41, "preferences_set", {
      key: "dietary",
      value: "vegetarian",
      notes: "No meat or fish",
    });
    const pref = JSON.parse(text) as Record<string, unknown>;
    expect(pref["key"]).toBe("dietary");
    expect(pref["value"]).toBe("vegetarian");
    expect(pref["notes"]).toBe("No meat or fish");
  });

  it("lists the created preference", async () => {
    const text = await resultText(42, "preferences_list");
    const prefs = JSON.parse(text) as Array<{ key: string; value: string }>;
    expect(prefs.some((p) => p.key === "dietary" && p.value === "vegetarian")).toBe(true);
  });

  it("sets a second preference", async () => {
    await resultText(43, "preferences_set", { key: "allergy", value: "nut-free" });
    const text = await resultText(44, "preferences_list");
    const prefs = JSON.parse(text) as Array<{ key: string }>;
    expect(prefs.length).toBe(2);
  });

  it("updates an existing preference and records history", async () => {
    await resultText(45, "preferences_set", { key: "dietary", value: "vegan" });
    const text = await resultText(46, "preferences_list", { key: "dietary", include_history: true });
    const data = JSON.parse(text) as {
      preferences: Array<{ value: string }>;
      history: Array<{ old_value: string | null; new_value: string }>;
    };
    expect(data.preferences[0]?.value).toBe("vegan");
    expect(data.history.length).toBeGreaterThanOrEqual(2);
    const firstEntry = data.history[data.history.length - 1];
    expect(firstEntry?.old_value).toBeNull();
    expect(firstEntry?.new_value).toBe("vegetarian");
  });

  it("filters to a specific key", async () => {
    const text = await resultText(47, "preferences_list", { key: "allergy" });
    const prefs = JSON.parse(text) as Array<{ key: string }>;
    expect(prefs.length).toBe(1);
    expect(prefs[0]?.key).toBe("allergy");
  });

  it("deletes a preference and records the deletion", async () => {
    const text = await resultText(48, "preferences_delete", { key: "allergy" });
    expect(text).toContain("Deleted preference: allergy");
    const listText = await resultText(49, "preferences_list");
    const prefs = JSON.parse(listText) as Array<{ key: string }>;
    expect(prefs.every((p) => p.key !== "allergy")).toBe(true);
  });

  it("returns error when preferences_set called without key", async () => {
    const res = await call(50, "preferences_set", { value: "vegan" });
    expect(res.result?.["isError"]).toBe(true);
  });
});

// ── Meal feedback & search ────────────────────────────────────────────────

describe("meal feedback and search", () => {
  const MON = "2026-05-04";
  const TUE = "2026-05-05";
  const WED = "2026-05-06";

  it("adds feedback to a meal and snapshots the meal entry", async () => {
    const text = await resultText(60, "meal_feedback_set", {
      date: MON,
      rating: 4,
      notes: "Pasta was great, slightly overcooked",
      tags: ["family_favorite", "quick"],
    });
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data["date"]).toBe(MON);
    expect(data["rating"]).toBe(4);
    expect(data["tags"]).toContain("family_favorite");
    const snapshot = data["meal_snapshot"] as Record<string, unknown>;
    expect(snapshot["name"]).toBe("updated pasta");
  });

  it("adds feedback to a second meal", async () => {
    await resultText(61, "meal_feedback_set", {
      date: TUE,
      rating: 5,
      notes: "Best stir fry ever, will repeat",
      tags: ["would_repeat"],
    });
  });

  it("updates existing feedback", async () => {
    const text = await resultText(62, "meal_feedback_set", {
      date: MON,
      rating: 3,
      notes: "Actually pasta was a bit bland",
    });
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data["rating"]).toBe(3);
    expect(data["notes"]).toBe("Actually pasta was a bit bland");
  });

  it("searches by keyword in meal name", async () => {
    const text = await resultText(63, "meal_search", { query: "pasta" });
    const results = JSON.parse(text) as Array<{ name: string }>;
    expect(results.some((r) => r.name.includes("pasta"))).toBe(true);
  });

  it("searches by keyword in feedback notes", async () => {
    const text = await resultText(64, "meal_search", { query: "stir fry" });
    const results = JSON.parse(text) as Array<{ name: string }>;
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by minimum rating", async () => {
    const text = await resultText(65, "meal_search", { min_rating: 5 });
    const results = JSON.parse(text) as Array<{ rating: number }>;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.rating >= 5)).toBe(true);
  });

  it("filters by tag", async () => {
    const text = await resultText(66, "meal_search", { tag: "would_repeat" });
    const results = JSON.parse(text) as Array<{ tags: string[] }>;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.tags.includes("would_repeat"))).toBe(true);
  });

  it("searches by ingredient keyword", async () => {
    // TUE has tofu as ingredient (set in meal plans describe block above)
    const text = await resultText(67, "meal_search", { query: "tofu" });
    const results = JSON.parse(text) as Array<{ name: string }>;
    expect(results.some((r) => r.name === "stir fry")).toBe(true);
  });

  it("returns no-match message for unmatched query", async () => {
    const text = await resultText(68, "meal_search", { query: "xyzzy_no_match" });
    expect(text).toContain("No meals found");
  });

  it("returns error when meal_feedback_set is missing date", async () => {
    const res = await call(69, "meal_feedback_set", { rating: 3 });
    expect(res.result?.["isError"]).toBe(true);
  });

  it("returns error when meal_feedback_set has no feedback fields", async () => {
    const res = await call(70, "meal_feedback_set", { date: WED });
    expect(res.result?.["isError"]).toBe(true);
  });

  it("returns error when meal_search has no filters", async () => {
    const res = await call(71, "meal_search", {});
    expect(res.result?.["isError"]).toBe(true);
  });

  it("creates a new feedback record when the meal changes", async () => {
    // Replace MON's meal with something entirely different
    await resultText(601, "meal_plan_set", {
      meals: [{ date: MON, name: "risotto" }],
    });
    // Feedback for the new meal → should create a NEW record snapshotting "risotto"
    const text = await resultText(602, "meal_feedback_set", {
      date: MON,
      rating: 5,
      notes: "Risotto was excellent",
    });
    const data = JSON.parse(text) as Record<string, unknown>;
    const snapshot = data["meal_snapshot"] as Record<string, unknown>;
    expect(snapshot["name"]).toBe("risotto");
  });

  it("edits the current-meal feedback when the meal is unchanged", async () => {
    // MON is still "risotto" — updating feedback should edit the existing risotto row
    const text = await resultText(603, "meal_feedback_set", {
      date: MON,
      notes: "Risotto was excellent — will make again",
    });
    const data = JSON.parse(text) as Record<string, unknown>;
    expect((data["meal_snapshot"] as Record<string, unknown>)["name"]).toBe("risotto");
    // Rating from the previous call should be preserved
    expect(data["rating"]).toBe(5);
  });

  it("meal_search returns feedback matching the current meal", async () => {
    // Search for "risotto" — should find MON with the risotto feedback
    const text = await resultText(604, "meal_search", { query: "risotto" });
    const results = JSON.parse(text) as Array<Record<string, unknown>>;
    const mon = results.find((r) => r["date"] === MON);
    expect(mon).toBeDefined();
    expect((mon!["meal_snapshot"] as Record<string, unknown>)["name"]).toBe("risotto");
    // Original pasta feedback is a separate record — not shown for risotto meal
    expect(mon!["rating"]).toBe(5);
  });
});
