import type { Env, MealFeedback, MealIngredient, ToolDefinition, ToolResult } from "../../types.ts";
import { getMealEntriesByDates, getMealEntries, getMealFeedbackForDate, listPantryItems, searchMeals, upsertMealFeedback } from "../../db/queries.ts";
import { getVectorizeBindings, queryMealVectors } from "../../vectorize.ts";
import type { MealSearchRow } from "../../db/queries.ts";

export const FEEDBACK_TOOLS: ToolDefinition[] = [
  {
    name: "meal_feedback_set",
    description:
      "Add or update feedback and a rating for a meal on a specific date. At least one of rating, notes, or tags must be provided. Matches on the current meal entry: if the meal has changed since the last feedback a new record is created; otherwise the existing one is updated.",
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
    name: "meal_feedback_get",
    description: "Get existing feedback for a meal on a specific date. Returns null if no feedback exists for the current meal version.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date of the meal (e.g. '2026-05-07')." },
      },
      required: ["date"],
    },
  },
  {
    name: "meal_search",
    description:
      "Search past meal entries. The query parameter accepts natural language (e.g. 'something light with chicken' or 'quick pasta dish') and uses semantic similarity — no need to match exact ingredient names. Rating and tag filters can be combined with or without a query. At least one filter is required.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query matched semantically against meal name and ingredients.",
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
  {
    name: "meal_plan_suggest",
    description:
      "Suggest past meals to cook again based on what's currently in the pantry. Uses semantic similarity between in-stock ingredients and previously saved meals. Optionally filter by minimum rating.",
    inputSchema: {
      type: "object",
      properties: {
        min_rating: {
          type: "integer",
          description: "Minimum rating filter, inclusive (1–5).",
          minimum: 1,
          maximum: 5,
        },
        limit: {
          type: "integer",
          description: "Maximum number of suggestions to return (1–10, default 5).",
          minimum: 1,
          maximum: 10,
        },
      },
    },
  },
];

function formatSearchResults(rows: MealSearchRow[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const result: Record<string, unknown> = { date: row.date, name: row.name };
    if (row.ingredients) result["ingredients"] = JSON.parse(row.ingredients) as MealIngredient[];
    if (row.steps) result["steps"] = JSON.parse(row.steps) as string[];
    if (row.rating !== null || row.notes || row.tags || row.meal_snapshot) {
      const feedback: Record<string, unknown> = {};
      if (row.rating !== null) feedback["rating"] = row.rating;
      if (row.notes) feedback["notes"] = row.notes;
      if (row.tags) feedback["tags"] = JSON.parse(row.tags) as string[];
      if (row.meal_snapshot) feedback["meal_snapshot"] = JSON.parse(row.meal_snapshot);
      result["feedback"] = feedback;
    }
    return result;
  });
}

async function semanticSearch(
  db: D1Database,
  index: VectorizeIndex,
  ai: Ai,
  householdId: string,
  query: string,
  opts: { minRating?: number; maxRating?: number; tag?: string },
): Promise<MealSearchRow[]> {
  const dates = await queryMealVectors(index, householdId, ai, query);
  if (dates.length === 0) return [];

  const mealRows = await getMealEntriesByDates(db, householdId, dates);
  if (mealRows.length === 0) return [];

  const placeholders = mealRows.map(() => "?").join(", ");
  const feedbackRows = (
    await db
      .prepare(`SELECT * FROM meal_feedback WHERE household_id = ? AND date IN (${placeholders})`)
      .bind(householdId, ...mealRows.map((m) => m.date))
      .all<MealFeedback>()
  ).results;

  const feedbackByDate = new Map<string, MealFeedback[]>();
  for (const fb of feedbackRows) {
    const list = feedbackByDate.get(fb.date) ?? [];
    list.push(fb);
    feedbackByDate.set(fb.date, list);
  }

  const mealByDate = new Map(mealRows.map((m) => [m.date, m]));
  const results: MealSearchRow[] = [];

  for (const date of dates) {
    const meal = mealByDate.get(date);
    if (!meal) continue;

    const currentSnapshotJson = JSON.stringify({ name: meal.name, ingredients: meal.ingredients, steps: meal.steps });
    const fb = (feedbackByDate.get(date) ?? []).find((f) => f.meal_snapshot === currentSnapshotJson) ?? null;

    if (opts.minRating !== undefined && (fb?.rating ?? null) === null) continue;
    if (opts.minRating !== undefined && fb!.rating! < opts.minRating) continue;
    if (opts.maxRating !== undefined && (fb?.rating ?? null) === null) continue;
    if (opts.maxRating !== undefined && fb!.rating! > opts.maxRating) continue;
    if (opts.tag) {
      if (!fb?.tags) continue;
      try {
        if (!(JSON.parse(fb.tags) as string[]).includes(opts.tag)) continue;
      } catch { continue; }
    }

    results.push({
      date: meal.date,
      name: meal.name,
      ingredients: meal.ingredients,
      steps: meal.steps,
      rating: fb?.rating ?? null,
      notes: fb?.notes ?? null,
      tags: fb?.tags ?? null,
      meal_snapshot: fb?.meal_snapshot ?? null,
    });

    if (results.length >= 50) break;
  }

  return results;
}

export async function handleFeedbackTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
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

      const mealExists = await getMealEntries(env.DB, householdId, args["date"], args["date"]);
      if (mealExists.length === 0) {
        return {
          content: [{ type: "text", text: `No meal set for ${args["date"]} — add a meal first before recording feedback` }],
          isError: true,
        };
      }

      const saved = await upsertMealFeedback(env.DB, householdId, args["date"], { rating, notes, tags });
      const data: Record<string, unknown> = { date: saved.date };
      if (saved.meal_snapshot !== null) data["meal_snapshot"] = JSON.parse(saved.meal_snapshot);
      if (saved.rating !== null) data["rating"] = saved.rating;
      if (saved.notes !== null) data["notes"] = saved.notes;
      if (saved.tags !== null) data["tags"] = JSON.parse(saved.tags) as string[];
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "meal_feedback_get": {
      if (typeof args["date"] !== "string") {
        return { content: [{ type: "text", text: "date is required" }], isError: true };
      }
      const fb = await getMealFeedbackForDate(env.DB, householdId, args["date"]);
      if (!fb) {
        return { content: [{ type: "text", text: "null" }] };
      }
      const data: Record<string, unknown> = { date: fb.date };
      if (fb.rating !== null) data["rating"] = fb.rating;
      if (fb.notes !== null) data["notes"] = fb.notes;
      if (fb.tags !== null) data["tags"] = JSON.parse(fb.tags) as string[];
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
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

      let rows: MealSearchRow[];

      const vb = getVectorizeBindings(env);
      if (query && vb) {
        rows = await semanticSearch(env.DB, vb.index, vb.ai, householdId, query, { minRating, maxRating, tag });
        if (rows.length === 0) {
          rows = await searchMeals(env.DB, householdId, { query, minRating, maxRating, tag });
        }
      } else {
        rows = await searchMeals(env.DB, householdId, { query, minRating, maxRating, tag });
      }

      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No meals found matching the search criteria" }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(formatSearchResults(rows), null, 2) }] };
    }

    case "meal_plan_suggest": {
      const vb = getVectorizeBindings(env);
      if (!vb) {
        return {
          content: [{ type: "text", text: "Meal suggestions require a Vectorize index — not available in this environment" }],
          isError: true,
        };
      }

      const minRating = typeof args["min_rating"] === "number" ? args["min_rating"] : undefined;
      const limit = typeof args["limit"] === "number" ? Math.min(Math.max(1, Math.round(args["limit"])), 10) : 5;

      const pantryItems = await listPantryItems(env.DB, householdId, { inStock: true });
      if (pantryItems.length === 0) {
        return {
          content: [{ type: "text", text: "Add pantry items first so suggestions can be matched to what you have in stock" }],
        };
      }

      const pantryQuery = pantryItems.map((i) => i.name).join(", ");
      const dates = await queryMealVectors(vb.index, householdId, vb.ai, pantryQuery, 20);
      if (dates.length === 0) {
        return { content: [{ type: "text", text: "No past meals found — add some meal plans first" }] };
      }

      const mealRows = await getMealEntriesByDates(env.DB, householdId, dates);
      if (mealRows.length === 0) {
        return { content: [{ type: "text", text: "No past meals found — add some meal plans first" }] };
      }

      const placeholders = mealRows.map(() => "?").join(", ");
      const feedbackRows = (
        await env.DB
          .prepare(`SELECT * FROM meal_feedback WHERE household_id = ? AND date IN (${placeholders})`)
          .bind(householdId, ...mealRows.map((m) => m.date))
          .all<MealFeedback>()
      ).results;

      const feedbackByDate = new Map<string, MealFeedback[]>();
      for (const fb of feedbackRows) {
        const list = feedbackByDate.get(fb.date) ?? [];
        list.push(fb);
        feedbackByDate.set(fb.date, list);
      }

      const pantryNames = new Set(pantryItems.map((i) => i.name.toLowerCase()));
      const mealByDate = new Map(mealRows.map((m) => [m.date, m]));
      const suggestions: Record<string, unknown>[] = [];

      for (const date of dates) {
        if (suggestions.length >= limit) break;
        const meal = mealByDate.get(date);
        if (!meal) continue;

        const currentSnapshotJson = JSON.stringify({ name: meal.name, ingredients: meal.ingredients, steps: meal.steps });
        const fb = (feedbackByDate.get(date) ?? []).find((f) => f.meal_snapshot === currentSnapshotJson) ?? null;

        if (minRating !== undefined && (fb?.rating ?? null) === null) continue;
        if (minRating !== undefined && fb!.rating! < minRating) continue;

        const suggestion: Record<string, unknown> = { date: meal.date, name: meal.name };
        if (fb?.rating !== null && fb?.rating !== undefined) suggestion["rating"] = fb.rating;
        if (fb?.tags) {
          try { suggestion["tags"] = JSON.parse(fb.tags) as string[]; } catch { /* skip */ }
        }

        if (meal.ingredients) {
          try {
            const ings = JSON.parse(meal.ingredients) as Array<{ name: string }>;
            const inStock = ings.filter((i) => pantryNames.has(i.name.toLowerCase())).map((i) => i.name);
            const missing = ings.filter((i) => !pantryNames.has(i.name.toLowerCase())).map((i) => i.name);
            suggestion["ingredients_in_stock"] = inStock;
            suggestion["ingredients_missing"] = missing;
          } catch { /* skip */ }
        }

        suggestions.push(suggestion);
      }

      if (suggestions.length === 0) {
        return { content: [{ type: "text", text: "No matching past meals found" }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
