import type { MealIngredient, ToolDefinition, ToolResult } from "../../types.ts";
import { searchMeals, upsertMealFeedback } from "../../db/queries.ts";

export const FEEDBACK_TOOLS: ToolDefinition[] = [
  {
    name: "meal_feedback_set",
    description:
      "Add or update feedback and a rating for a meal on a specific date. At least one of rating, notes, or tags must be provided. Upserts — calling again for the same date replaces existing feedback.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "ISO date of the meal (e.g. '2026-05-07').",
        },
        rating: {
          type: "integer",
          description: "Rating from 1 (poor) to 5 (excellent).",
          minimum: 1,
          maximum: 5,
        },
        notes: {
          type: "string",
          description: "Free text notes — what worked, what to change next time.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Labels for the meal, e.g. 'family_favorite', 'too_spicy', 'quick', 'would_repeat'.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "meal_search",
    description:
      "Search past meal entries by keyword (matches meal name, ingredients, and feedback notes), rating range, or tag. Returns meals with any associated feedback. At least one filter is required.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword to match against meal name, ingredients, and feedback notes.",
        },
        min_rating: {
          type: "integer",
          description: "Minimum rating filter, inclusive (1–5).",
          minimum: 1,
          maximum: 5,
        },
        max_rating: {
          type: "integer",
          description: "Maximum rating filter, inclusive (1–5).",
          minimum: 1,
          maximum: 5,
        },
        tag: {
          type: "string",
          description: "Filter to meals tagged with this exact label.",
        },
      },
    },
  },
];

export async function handleFeedbackTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  switch (name) {
    case "meal_feedback_set": {
      if (typeof args["date"] !== "string") {
        return { content: [{ type: "text", text: "date is required" }], isError: true };
      }

      const rating = typeof args["rating"] === "number" ? Math.round(args["rating"]) : undefined;
      if (rating !== undefined && (rating < 1 || rating > 5)) {
        return { content: [{ type: "text", text: "rating must be between 1 and 5" }], isError: true };
      }

      const notes = typeof args["notes"] === "string" ? args["notes"] : undefined;
      const tags = Array.isArray(args["tags"])
        ? (args["tags"] as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined;

      if (rating === undefined && notes === undefined && tags === undefined) {
        return {
          content: [{ type: "text", text: "at least one of rating, notes, or tags is required" }],
          isError: true,
        };
      }

      const saved = await upsertMealFeedback(db, householdId, args["date"], { rating, notes, tags });
      const data: Record<string, unknown> = { date: saved.date };
      if (saved.meal_snapshot !== null) data["meal_snapshot"] = JSON.parse(saved.meal_snapshot);
      if (saved.rating !== null) data["rating"] = saved.rating;
      if (saved.notes !== null) data["notes"] = saved.notes;
      if (saved.tags !== null) data["tags"] = JSON.parse(saved.tags) as string[];
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "meal_search": {
      const query = typeof args["query"] === "string" ? args["query"] : undefined;
      const minRating = typeof args["min_rating"] === "number" ? args["min_rating"] : undefined;
      const maxRating = typeof args["max_rating"] === "number" ? args["max_rating"] : undefined;
      const tag = typeof args["tag"] === "string" ? args["tag"] : undefined;

      if (!query && minRating === undefined && maxRating === undefined && !tag) {
        return {
          content: [{
            type: "text",
            text: "at least one search parameter is required (query, min_rating, max_rating, or tag)",
          }],
          isError: true,
        };
      }

      const rows = await searchMeals(db, householdId, { query, minRating, maxRating, tag });

      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No meals found matching the search criteria" }] };
      }

      const results = rows.map((row) => {
        const result: Record<string, unknown> = { date: row.date, name: row.name };
        if (row.ingredients) result["ingredients"] = JSON.parse(row.ingredients) as MealIngredient[];
        if (row.steps) result["steps"] = JSON.parse(row.steps) as string[];
        if (row.rating !== null) result["rating"] = row.rating;
        if (row.feedback_notes) result["feedback_notes"] = row.feedback_notes;
        if (row.tags) result["tags"] = JSON.parse(row.tags) as string[];
        if (row.meal_snapshot) result["meal_snapshot"] = JSON.parse(row.meal_snapshot);
        return result;
      });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
