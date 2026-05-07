import { getValidToken, clearTokens } from "./auth.ts";

const WORKER_BASE = import.meta.env.VITE_WORKER_URL ?? "";

// ── Types mirrored from the Worker ───────────────────────────────────────

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  in_stock: 0 | 1;
  updated_at: number;
}

export interface MealIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface MealEntry {
  id: string;
  household_id: string;
  date: string;
  name: string;
  ingredients: string | null;
  steps: string | null;
  created_at: number;
}

export interface MealEntryData {
  date: string;
  name: string;
  ingredients?: MealIngredient[];
  steps?: string[];
}

// ── Transport ─────────────────────────────────────────────────────────────

async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const token = await getValidToken();
  if (!token) {
    clearTokens();
    throw new AuthError("Not authenticated");
  }

  const res = await fetch(`${WORKER_BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  if (res.status === 401) {
    clearTokens();
    throw new AuthError("Session expired");
  }

  if (!res.ok) throw new Error(`MCP request failed: ${res.status}`);

  const { result, error } = (await res.json()) as {
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
    error?: { message: string };
  };

  if (error) throw new Error(error.message);
  if (!result) throw new Error("Empty MCP response");
  if (result.isError) throw new Error(result.content[0]?.text ?? "Tool error");

  return JSON.parse(result.content[0].text) as T;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export const listPantryItems = (opts: {
  category?: string;
  in_stock?: boolean;
} = {}) => mcpCall<PantryItem[]>("pantry_list", opts as Record<string, unknown>);

export const updatePantryItem = (item: {
  name: string;
  category?: string;
  quantity?: number;
  unit?: string;
  in_stock?: boolean;
}) => mcpCall<PantryItem>("pantry_update", item as Record<string, unknown>);

export const markItemsOut = (names: string[]) =>
  mcpCall<void>("pantry_mark_out", { names });

export const bulkUpdatePantry = (
  items: Array<{
    name: string;
    category?: string;
    quantity?: number;
    unit?: string;
    in_stock?: boolean;
  }>,
) => mcpCall<PantryItem[]>("pantry_bulk_update", { items });

export const getMealPlan = (dateFrom: string, dateTo: string) =>
  mcpCall<MealEntry[]>("meal_plan_get", { date_from: dateFrom, date_to: dateTo });

export const setMeals = (meals: MealEntryData[]) =>
  mcpCall<MealEntry[]>("meal_plan_set", { meals });

export const deleteMeals = (dates: string[]) =>
  mcpCall<void>("meal_plan_delete", { dates });
