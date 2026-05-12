import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MealEntryData, PantryItem } from "../../types/shared.ts";

vi.mock("./auth.ts", () => ({
  getValidToken: vi.fn().mockResolvedValue("test-token"),
  clearTokens: vi.fn(),
}));

import { getValidToken, clearTokens } from "./auth.ts";
import { getMealPlan, listPantryItems, markItemsOut, deletePantryItem, getMealFeedback, setMealFeedback, AuthError } from "./api.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function mcpOk(text: string) {
  return { result: { content: [{ type: "text", text }] } };
}

function mcpToolError(text: string) {
  return { result: { content: [{ type: "text", text }], isError: true } };
}

// ── getMealPlan ───────────────────────────────────────────────────────────

describe("getMealPlan", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("returns [] when backend reports no meals", async () => {
    mockFetch(mcpOk("[]"));
    const result = await getMealPlan("2026-04-26", "2026-06-07");
    expect(result).toEqual([]);
  });

  it("returns the meals array when meals exist", async () => {
    const meals: MealEntryData[] = [
      { date: "2026-05-07", name: "Pasta carbonara" },
    ];
    mockFetch(mcpOk(JSON.stringify(meals)));
    const result = await getMealPlan("2026-05-01", "2026-05-07");
    expect(result).toEqual(meals);
  });

  it("throws AuthError when getValidToken returns null", async () => {
    vi.mocked(getValidToken).mockResolvedValue(null);
    await expect(getMealPlan("2026-05-01", "2026-05-07")).rejects.toThrow(AuthError);
    expect(clearTokens).toHaveBeenCalled();
  });

  it("throws AuthError on HTTP 401", async () => {
    mockFetch({}, 401);
    await expect(getMealPlan("2026-05-01", "2026-05-07")).rejects.toThrow(AuthError);
  });

  it("throws when the tool returns isError", async () => {
    mockFetch(mcpToolError("household not found"));
    await expect(getMealPlan("2026-05-01", "2026-05-07")).rejects.toThrow("household not found");
  });

  it("throws a clear error when the tool response is not valid JSON", async () => {
    // Guards against future backend regressions returning plain text
    mockFetch(mcpOk("No meals found between 2026-04-26 and 2026-06-07"));
    await expect(getMealPlan("2026-04-26", "2026-06-07")).rejects.toThrow(
      "Tool response was not valid JSON",
    );
  });

  it("sends the correct date range in the MCP call", async () => {
    mockFetch(mcpOk("[]"));
    await getMealPlan("2026-05-01", "2026-05-31");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as {
      params: { arguments: { date_from: string; date_to: string } };
    };
    expect(body.params.arguments).toEqual({ date_from: "2026-05-01", date_to: "2026-05-31" });
  });
});

// ── listPantryItems ───────────────────────────────────────────────────────

describe("listPantryItems", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("returns items array", async () => {
    const items: Partial<PantryItem>[] = [
      { id: "1", name: "Olive oil", in_stock: 1, category: "pantry", quantity: null, unit: null },
    ];
    mockFetch(mcpOk(JSON.stringify(items)));
    const result = await listPantryItems();
    expect(result).toEqual(items);
  });

  it("returns empty array when pantry is empty", async () => {
    mockFetch(mcpOk("[]"));
    const result = await listPantryItems();
    expect(result).toEqual([]);
  });
});

// ── markItemsOut ──────────────────────────────────────────────────────────

describe("markItemsOut", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("resolves without throwing on success", async () => {
    mockFetch(mcpOk(JSON.stringify({ marked_out: 2 })));
    await expect(markItemsOut(["olive oil", "eggs"])).resolves.not.toThrow();
  });
});

// ── deletePantryItem ──────────────────────────────────────────────────────

describe("deletePantryItem", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("returns { deleted: true } when item was deleted", async () => {
    mockFetch(mcpOk(JSON.stringify({ deleted: true })));
    const result = await deletePantryItem("olive oil");
    expect(result).toEqual({ deleted: true });
  });

  it("returns { deleted: false } when item was not found", async () => {
    mockFetch(mcpOk(JSON.stringify({ deleted: false })));
    const result = await deletePantryItem("ghost item");
    expect(result).toEqual({ deleted: false });
  });

  it("throws when the tool returns isError", async () => {
    mockFetch(mcpToolError("name is required"));
    await expect(deletePantryItem("")).rejects.toThrow("name is required");
  });

  it("throws AuthError on HTTP 401", async () => {
    mockFetch({}, 401);
    await expect(deletePantryItem("olive oil")).rejects.toThrow(AuthError);
  });
});

// ── getMealFeedback ───────────────────────────────────────────────────────

describe("getMealFeedback", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("returns null when no feedback exists", async () => {
    mockFetch(mcpOk("null"));
    const result = await getMealFeedback("2026-05-07");
    expect(result).toBeNull();
  });

  it("returns feedback when it exists", async () => {
    const fb = { date: "2026-05-07", rating: 4, notes: "Tasty", tags: ["quick"] };
    mockFetch(mcpOk(JSON.stringify(fb)));
    const result = await getMealFeedback("2026-05-07");
    expect(result).toEqual(fb);
  });

  it("throws when the tool returns isError", async () => {
    mockFetch(mcpToolError("date is required"));
    await expect(getMealFeedback("")).rejects.toThrow("date is required");
  });

  it("throws AuthError on HTTP 401", async () => {
    mockFetch({}, 401);
    await expect(getMealFeedback("2026-05-07")).rejects.toThrow(AuthError);
  });
});

// ── setMealFeedback ───────────────────────────────────────────────────────

describe("setMealFeedback", () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockResolvedValue("test-token");
  });

  it("returns saved feedback on success", async () => {
    const fb = { date: "2026-05-07", rating: 5, notes: "Perfect", tags: ["family_favorite"] };
    mockFetch(mcpOk(JSON.stringify(fb)));
    const result = await setMealFeedback({ date: "2026-05-07", rating: 5, notes: "Perfect", tags: ["family_favorite"] });
    expect(result).toEqual(fb);
  });

  it("throws when the tool returns isError", async () => {
    mockFetch(mcpToolError("at least one of rating, notes, or tags is required"));
    await expect(setMealFeedback({ date: "2026-05-07" })).rejects.toThrow("at least one of rating");
  });

  it("throws AuthError on HTTP 401", async () => {
    mockFetch({}, 401);
    await expect(setMealFeedback({ date: "2026-05-07", rating: 3 })).rejects.toThrow(AuthError);
  });
});
