import { getValidToken, clearTokens } from "./auth.ts";
export type { PantryItem, MealIngredient, MealEntry, MealEntryData } from "../../types/shared.ts";
import type { PantryItem, MealEntry, MealEntryData } from "../../types/shared.ts";

const WORKER_BASE = import.meta.env.VITE_WORKER_URL ?? "";

// ── Transport ─────────────────────────────────────────────────────────────

async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;
  const authHeaders: Record<string, string> = {};

  if (devToken) {
    authHeaders["X-Dev-Token"] = devToken;
  } else {
    const token = await getValidToken();
    if (!token) {
      clearTokens();
      throw new AuthError("Not authenticated");
    }
    authHeaders["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${WORKER_BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
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

  const text = result.content[0]?.text ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Tool response was not valid JSON: ${text}`);
  }
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
