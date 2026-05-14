import type { GroceryItem, MealIngredient } from "../../../types/shared.ts";
import type { MealEntry, PantryItem, ToolDefinition, ToolResult } from "../../types.ts";
import { getMealEntries, listPantryItems } from "../../db/queries.ts";

function currentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  return monday.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildGroceryList(meals: MealEntry[], pantry: PantryItem[]): GroceryItem[] {
  const pantryMap = new Map<string, PantryItem>();
  for (const p of pantry) {
    pantryMap.set(p.name.toLowerCase(), p);
  }

  // Aggregate ingredient quantities across all meals; key = "name_lower|unit_lower"
  const aggregated = new Map<string, GroceryItem>();
  for (const meal of meals) {
    const ingredients: MealIngredient[] = meal.ingredients
      ? (JSON.parse(meal.ingredients) as MealIngredient[])
      : [];
    for (const ing of ingredients) {
      const key = `${ing.name.toLowerCase()}|${(ing.unit ?? "").toLowerCase()}`;
      const existing = aggregated.get(key);
      if (existing) {
        if (ing.quantity !== undefined) {
          existing.quantity = (existing.quantity ?? 0) + ing.quantity;
        }
      } else {
        const pantryItem = pantryMap.get(ing.name.toLowerCase());
        aggregated.set(key, {
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          category: pantryItem?.category ?? null,
        });
      }
    }
  }

  // Keep only items that are absent from the pantry or out of stock
  return [...aggregated.values()]
    .filter(ing => {
      const p = pantryMap.get(ing.name.toLowerCase());
      return !p || p.in_stock === 0;
    })
    .sort((a, b) => {
      const catCmp = (a.category ?? "").localeCompare(b.category ?? "");
      if (catCmp !== 0) return catCmp;
      return a.name.localeCompare(b.name);
    });
}

export const GROCERY_TOOLS: ToolDefinition[] = [
  {
    name: "grocery_list",
    description:
      "Returns ingredients from planned meals that are missing from or out of stock in the pantry, for a given date range. Aggregates quantities across meals. Defaults to the current week.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: {
          type: "string",
          description: "Start of date range (ISO date, inclusive). Defaults to this Monday.",
        },
        date_to: {
          type: "string",
          description: "End of date range (ISO date, inclusive). Defaults to this Sunday.",
        },
      },
    },
  },
];

export async function handleGroceryTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  if (name !== "grocery_list") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const weekStart = currentWeekStart();
  const dateFrom = typeof args["date_from"] === "string" ? args["date_from"] : weekStart;
  const dateTo = typeof args["date_to"] === "string" ? args["date_to"] : addDays(weekStart, 6);

  const [meals, pantry] = await Promise.all([
    getMealEntries(db, householdId, dateFrom, dateTo),
    listPantryItems(db, householdId),
  ]);

  const items = buildGroceryList(meals, pantry);
  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}
