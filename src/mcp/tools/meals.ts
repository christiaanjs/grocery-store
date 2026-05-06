import type { MealEntryData, MealIngredient, ToolDefinition, ToolResult } from "../../types.ts";
import { deleteMealEntries, getMealEntries, upsertMealEntry } from "../../db/queries.ts";

function currentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
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

function parseDateRange(args: Record<string, unknown>): { dateFrom: string; dateTo: string } {
  if (typeof args["date"] === "string") {
    return { dateFrom: args["date"], dateTo: args["date"] };
  }
  if (typeof args["week_start"] === "string") {
    return { dateFrom: args["week_start"], dateTo: addDays(args["week_start"], 6) };
  }
  if (typeof args["date_from"] === "string" || typeof args["date_to"] === "string") {
    const weekStart = currentWeekStart();
    return {
      dateFrom: typeof args["date_from"] === "string" ? args["date_from"] : weekStart,
      dateTo: typeof args["date_to"] === "string" ? args["date_to"] : addDays(weekStart, 6),
    };
  }
  const weekStart = currentWeekStart();
  return { dateFrom: weekStart, dateTo: addDays(weekStart, 6) };
}

function parseEntry(raw: unknown): { date: string; name: string; ingredients?: MealIngredient[]; steps?: string[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["date"] !== "string" || typeof obj["name"] !== "string") return null;

  const entry: { date: string; name: string; ingredients?: MealIngredient[]; steps?: string[] } = {
    date: obj["date"],
    name: obj["name"],
  };

  if (Array.isArray(obj["ingredients"])) {
    entry.ingredients = obj["ingredients"].flatMap((i) => {
      if (typeof i !== "object" || i === null) return [];
      const ing = i as Record<string, unknown>;
      if (typeof ing["name"] !== "string") return [];
      const result: MealIngredient = { name: ing["name"] };
      if (typeof ing["quantity"] === "number") result.quantity = ing["quantity"];
      if (typeof ing["unit"] === "string") result.unit = ing["unit"];
      return [result];
    });
  }

  if (Array.isArray(obj["steps"])) {
    entry.steps = obj["steps"].filter((s): s is string => typeof s === "string");
  }

  return entry;
}

function toEntryData(row: { date: string; name: string; ingredients: string | null; steps: string | null }): MealEntryData {
  const data: MealEntryData = { date: row.date, name: row.name };
  if (row.ingredients) data.ingredients = JSON.parse(row.ingredients) as MealIngredient[];
  if (row.steps) data.steps = JSON.parse(row.steps) as string[];
  return data;
}

export const MEAL_TOOLS: ToolDefinition[] = [
  {
    name: "meal_plan_get",
    description:
      "Get meal entries for a date range. Use week_start for a full Mon–Sun week, date for a single day, or date_from/date_to for an arbitrary range. Defaults to the current week.",
    inputSchema: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description: "ISO Monday date — returns the full Mon–Sun week (e.g. '2026-05-04').",
        },
        date: {
          type: "string",
          description: "ISO date — returns just that day (e.g. '2026-05-07').",
        },
        date_from: {
          type: "string",
          description: "Start of an arbitrary range (ISO date). Use with date_to.",
        },
        date_to: {
          type: "string",
          description: "End of an arbitrary range (ISO date, inclusive). Use with date_from.",
        },
      },
    },
  },
  {
    name: "meal_plan_set",
    description:
      "Set or update meal entries. Pass one or more meals, each with a date, name, and optional ingredients and steps. Upserts — existing entries for the same date are replaced.",
    inputSchema: {
      type: "object",
      properties: {
        meals: {
          type: "array",
          description: "List of meal entries to set.",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "ISO date (e.g. '2026-05-07')." },
              name: { type: "string", description: "Meal name." },
              ingredients: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "number" },
                    unit: { type: "string" },
                  },
                  required: ["name"],
                },
              },
              steps: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["date", "name"],
          },
        },
      },
      required: ["meals"],
    },
  },
  {
    name: "meal_plan_delete",
    description: "Delete meal entries for one or more specific dates.",
    inputSchema: {
      type: "object",
      properties: {
        dates: {
          type: "array",
          items: { type: "string" },
          description: "ISO dates to delete (e.g. ['2026-05-07', '2026-05-08']).",
        },
      },
      required: ["dates"],
    },
  },
];

export async function handleMealTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  switch (name) {
    case "meal_plan_get": {
      const { dateFrom, dateTo } = parseDateRange(args);
      const rows = await getMealEntries(db, householdId, dateFrom, dateTo);
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No meals found between ${dateFrom} and ${dateTo}` }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(rows.map(toEntryData), null, 2) }],
      };
    }

    case "meal_plan_set": {
      if (!Array.isArray(args["meals"]) || args["meals"].length === 0) {
        return { content: [{ type: "text", text: "meals must be a non-empty array" }], isError: true };
      }
      const entries = (args["meals"] as unknown[]).map(parseEntry);
      const invalid = entries.findIndex((e) => e === null);
      if (invalid !== -1) {
        return {
          content: [{ type: "text", text: `meals[${invalid}] is missing required fields: date and name` }],
          isError: true,
        };
      }
      const saved = await Promise.all(
        (entries as NonNullable<ReturnType<typeof parseEntry>>[]).map((e) =>
          upsertMealEntry(db, householdId, e),
        ),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(saved.map(toEntryData), null, 2) }],
      };
    }

    case "meal_plan_delete": {
      if (!Array.isArray(args["dates"]) || args["dates"].length === 0) {
        return { content: [{ type: "text", text: "dates must be a non-empty array" }], isError: true };
      }
      const dates = (args["dates"] as unknown[]).filter((d): d is string => typeof d === "string");
      const count = await deleteMealEntries(db, householdId, dates);
      return { content: [{ type: "text", text: `Deleted ${count} meal entry/entries` }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
