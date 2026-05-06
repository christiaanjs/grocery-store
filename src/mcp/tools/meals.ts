import type { DayMeals, ToolDefinition, ToolResult } from "../../types.ts";
import { getMealPlan, upsertMealPlan } from "../../db/queries.ts";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function currentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  return monday.toISOString().slice(0, 10);
}

export const MEAL_TOOLS: ToolDefinition[] = [
  {
    name: "meal_plan_get",
    description: "Get the meal plan for a given week. Defaults to the current week.",
    inputSchema: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description: "ISO date of the Monday (e.g. 2025-05-05). Defaults to current week.",
        },
      },
    },
  },
  {
    name: "meal_plan_set",
    description: "Set or update meals for specific days. Merges with any existing plan for that week.",
    inputSchema: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description: "ISO date of the Monday. Defaults to current week.",
        },
        meals: {
          type: "object",
          description: "Map of day abbreviation (mon–sun) to meal description",
          properties: Object.fromEntries(DAYS.map((d) => [d, { type: "string" }])),
        },
      },
      required: ["meals"],
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
      const weekStart =
        typeof args["week_start"] === "string" ? args["week_start"] : currentWeekStart();
      const plan = await getMealPlan(db, householdId, weekStart);
      if (!plan) {
        return {
          content: [{ type: "text", text: `No meal plan found for week of ${weekStart}` }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { week_start: plan.week_start, meals: JSON.parse(plan.meals) as DayMeals },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "meal_plan_set": {
      if (typeof args["meals"] !== "object" || args["meals"] === null) {
        return { content: [{ type: "text", text: "meals is required" }], isError: true };
      }
      const weekStart =
        typeof args["week_start"] === "string" ? args["week_start"] : currentWeekStart();
      const raw = args["meals"] as Record<string, unknown>;
      const meals: Record<string, string | undefined> = {};
      for (const day of DAYS) {
        if (typeof raw[day] === "string") meals[day] = raw[day] as string;
      }
      const plan = await upsertMealPlan(db, householdId, weekStart, meals);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { week_start: plan.week_start, meals: JSON.parse(plan.meals) as DayMeals },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
