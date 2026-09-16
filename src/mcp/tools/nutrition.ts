import type { FoodLogEntry, FoodLogEntryData, IngredientMacros, IngredientMacrosData, MealIngredient, NutritionTotals, ToolDefinition, ToolResult } from "../../types.ts";
import {
  addFoodLogEntries,
  deleteFoodLogEntries,
  deleteIngredientMacros,
  getFoodLogEntries,
  getIngredientMacrosByName,
  getMealEntries,
  listIngredientMacros,
  upsertIngredientMacros,
} from "../../db/queries.ts";

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

// Exact metric conversions only — no cross-family (mass<->volume) or imperial
// approximations, since those would silently produce wrong nutrition numbers.
const MASS_TO_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
};
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, millilitre: 1, millilitres: 1, milliliter: 1, milliliters: 1,
  l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000,
};

// Converts `quantity` from `fromUnit` into `toUnit`. A missing fromUnit is assumed to
// already be in toUnit (preserves prior behavior when no unit is given). Returns null
// when the units are unknown or from incompatible families (mass vs. volume, etc.) —
// callers must treat that as "can't safely scale" rather than silently using quantity as-is.
function convertQuantity(quantity: number, fromUnit: string | undefined, toUnit: string): number | null {
  const from = (fromUnit ?? toUnit).trim().toLowerCase();
  const to = toUnit.trim().toLowerCase();
  if (from === to) return quantity;
  if (from in MASS_TO_GRAMS && to in MASS_TO_GRAMS) {
    return (quantity * MASS_TO_GRAMS[from]!) / MASS_TO_GRAMS[to]!;
  }
  if (from in VOLUME_TO_ML && to in VOLUME_TO_ML) {
    return (quantity * VOLUME_TO_ML[from]!) / VOLUME_TO_ML[to]!;
  }
  return null;
}

function parseDateRange(args: Record<string, unknown>): { date?: string; dateFrom: string; dateTo: string } {
  if (typeof args["date"] === "string") {
    return { date: args["date"], dateFrom: args["date"], dateTo: args["date"] };
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
  const today = new Date().toISOString().slice(0, 10);
  return { date: today, dateFrom: today, dateTo: today };
}

function toEntryData(row: FoodLogEntry): FoodLogEntryData {
  return {
    id: row.id,
    date: row.date,
    meal_category: row.meal_category,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    calories: row.calories,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    fiber_g: row.fiber_g,
    saturated_fat_g: row.saturated_fat_g,
    sodium_mg: row.sodium_mg,
  };
}

function toMacrosData(row: IngredientMacros): IngredientMacrosData {
  return {
    name: row.name,
    serving_size: row.serving_size,
    serving_unit: row.serving_unit,
    calories: row.calories,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    fiber_g: row.fiber_g,
    saturated_fat_g: row.saturated_fat_g,
    sodium_mg: row.sodium_mg,
  };
}

// Distinguishes "key absent" (undefined — preserve the existing stored value on update)
// from "key explicitly null" (clear the stored value) from "key is a number" (set it).
// A present-but-wrong-typed value is treated as absent/preserve.
function optionalNumber(args: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in args)) return undefined;
  const value = args[key];
  if (value === null) return null;
  return typeof value === "number" ? value : undefined;
}

function zeroTotals(): NutritionTotals {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, saturated_fat_g: 0, sodium_mg: 0 };
}

function sumTotals(entries: FoodLogEntryData[]): NutritionTotals {
  return entries.reduce((acc, e) => {
    acc.calories += e.calories;
    acc.protein_g += e.protein_g ?? 0;
    acc.carbs_g += e.carbs_g ?? 0;
    acc.fat_g += e.fat_g ?? 0;
    acc.fiber_g += e.fiber_g ?? 0;
    acc.saturated_fat_g += e.saturated_fat_g ?? 0;
    acc.sodium_mg += e.sodium_mg ?? 0;
    return acc;
  }, zeroTotals());
}

interface ParsedFoodLogEntry {
  mealCategory: string;
  name: string;
  quantity?: number;
  unit?: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  saturatedFatG: number | null;
  sodiumMg: number | null;
}

async function resolveEntry(
  db: D1Database,
  householdId: string,
  raw: Record<string, unknown>,
  index: number,
): Promise<{ entry: ParsedFoodLogEntry } | { error: string }> {
  if (typeof raw["name"] !== "string" || raw["name"].trim() === "") {
    return { error: `entries[${index}] is missing required field: name` };
  }
  const name = raw["name"];
  const mealCategory = typeof raw["meal_category"] === "string" && raw["meal_category"].trim() !== ""
    ? raw["meal_category"]
    : "other";
  const quantity = typeof raw["quantity"] === "number" ? raw["quantity"] : undefined;
  const unit = typeof raw["unit"] === "string" ? raw["unit"] : undefined;

  if (typeof raw["calories"] === "number") {
    return {
      entry: {
        mealCategory,
        name,
        quantity,
        unit,
        calories: raw["calories"],
        proteinG: typeof raw["protein_g"] === "number" ? raw["protein_g"] : null,
        carbsG: typeof raw["carbs_g"] === "number" ? raw["carbs_g"] : null,
        fatG: typeof raw["fat_g"] === "number" ? raw["fat_g"] : null,
        fiberG: typeof raw["fiber_g"] === "number" ? raw["fiber_g"] : null,
        saturatedFatG: typeof raw["saturated_fat_g"] === "number" ? raw["saturated_fat_g"] : null,
        sodiumMg: typeof raw["sodium_mg"] === "number" ? raw["sodium_mg"] : null,
      },
    };
  }

  // No explicit calories — look up stored macros for this ingredient and scale by quantity.
  const macros = await getIngredientMacrosByName(db, householdId, name);
  if (!macros) {
    return {
      error: `entries[${index}] ("${name}") has no calories and no stored macros were found — provide calories directly or add it via ingredient_macros_set first`,
    };
  }
  let ratio = 1;
  if (quantity !== undefined) {
    const converted = convertQuantity(quantity, unit, macros.serving_unit);
    if (converted === null) {
      return {
        error: `entries[${index}] ("${name}") has quantity in "${unit}" but stored macros are per "${macros.serving_unit}" — use a matching/convertible unit or provide calories directly`,
      };
    }
    ratio = converted / macros.serving_size;
  }
  return {
    entry: {
      mealCategory,
      name,
      quantity,
      unit: unit ?? (quantity !== undefined ? undefined : macros.serving_unit),
      calories: macros.calories * ratio,
      proteinG: macros.protein_g !== null ? macros.protein_g * ratio : null,
      carbsG: macros.carbs_g !== null ? macros.carbs_g * ratio : null,
      fatG: macros.fat_g !== null ? macros.fat_g * ratio : null,
      fiberG: macros.fiber_g !== null ? macros.fiber_g * ratio : null,
      saturatedFatG: macros.saturated_fat_g !== null ? macros.saturated_fat_g * ratio : null,
      sodiumMg: macros.sodium_mg !== null ? macros.sodium_mg * ratio : null,
    },
  };
}

// Aggregates a saved meal's ingredient list into a single set of totals using stored
// ingredient_macros profiles, scaled by each ingredient's quantity. Ingredients with no
// stored macros are skipped and reported back so the caller can flag them as missing.
async function computeMealNutrition(
  db: D1Database,
  householdId: string,
  ingredients: MealIngredient[],
): Promise<{ totals: NutritionTotals; found: Set<keyof NutritionTotals>; missing: string[] }> {
  const totals = zeroTotals();
  const found = new Set<keyof NutritionTotals>();
  const missing: string[] = [];

  for (const ing of ingredients) {
    const macros = await getIngredientMacrosByName(db, householdId, ing.name);
    if (!macros) {
      missing.push(ing.name);
      continue;
    }
    let ratio = 1;
    if (ing.quantity !== undefined) {
      const converted = convertQuantity(ing.quantity, ing.unit, macros.serving_unit);
      if (converted === null) {
        missing.push(`${ing.name} (unit mismatch: "${ing.unit}" vs. stored "${macros.serving_unit}")`);
        continue;
      }
      ratio = converted / macros.serving_size;
    }
    totals.calories += macros.calories * ratio;
    found.add("calories");
    for (const [field, value] of [
      ["protein_g", macros.protein_g],
      ["carbs_g", macros.carbs_g],
      ["fat_g", macros.fat_g],
      ["fiber_g", macros.fiber_g],
      ["saturated_fat_g", macros.saturated_fat_g],
      ["sodium_mg", macros.sodium_mg],
    ] as const) {
      if (value !== null) {
        totals[field] += value * ratio;
        found.add(field);
      }
    }
  }

  return { totals, found, missing };
}

const MACRO_FIELD_SCHEMA = {
  protein_g: { type: "number", description: "Protein in grams." },
  carbs_g: { type: "number", description: "Carbohydrates in grams." },
  fat_g: { type: "number", description: "Total fat in grams." },
  fiber_g: { type: "number", description: "Dietary fiber in grams." },
  saturated_fat_g: { type: "number", description: "Saturated fat in grams." },
  sodium_mg: { type: "number", description: "Sodium in milligrams." },
};

export const NUTRITION_TOOLS: ToolDefinition[] = [
  {
    name: "ingredient_macros_set",
    description:
      "Store or update the calorie/macro profile for an ingredient, per a given serving size (e.g. 100g). Used to auto-calculate calories when logging that ingredient by quantity. When updating an existing profile, omitting an optional macro field leaves its stored value unchanged — pass it as null explicitly to clear it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Ingredient name (matches pantry/meal ingredient names)." },
        serving_size: { type: "number", description: "Serving size the macros below refer to. Defaults to 100." },
        serving_unit: { type: "string", description: "Unit for serving_size, e.g. 'g', 'ml', 'count'. Defaults to 'g'." },
        calories: { type: "number", description: "Calories per serving_size/serving_unit." },
        ...MACRO_FIELD_SCHEMA,
      },
      required: ["name", "calories"],
    },
  },
  {
    name: "ingredient_macros_list",
    description: "List stored calorie/macro profiles for all known ingredients.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ingredient_macros_delete",
    description: "Delete a stored ingredient macro profile by name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Ingredient name to remove." } },
      required: ["name"],
    },
  },
  {
    name: "food_log_add",
    description:
      "Log ingredients and/or meals eaten on a given day, grouped flexibly by meal_category (e.g. breakfast, lunch, dinner, snack, or any custom label). For each entry, either provide calories (and optionally protein_g/carbs_g/fat_g/fiber_g/saturated_fat_g/sodium_mg) directly for a whole meal, or omit calories and provide quantity to auto-calculate from a stored ingredient_macros profile matching the entry's name.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date the food was eaten (e.g. '2026-05-07')." },
        entries: {
          type: "array",
          description: "Items eaten on this date.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Ingredient or meal name." },
              meal_category: { type: "string", description: "e.g. 'breakfast', 'lunch', 'dinner', 'snack'. Defaults to 'other'." },
              quantity: { type: "number", description: "Amount eaten. Combined with a stored ingredient_macros profile to compute calories if calories is omitted." },
              unit: { type: "string", description: "Unit for quantity, e.g. 'g', 'count'." },
              calories: { type: "number", description: "Total calories for this entry. If omitted, looked up from ingredient_macros by name + quantity." },
              ...MACRO_FIELD_SCHEMA,
            },
            required: ["name"],
          },
        },
      },
      required: ["date", "entries"],
    },
  },
  {
    name: "food_log_get",
    description:
      "Get logged food entries and daily calorie/macro totals. Use date for a single day, week_start for a Mon–Sun week, or date_from/date_to for an arbitrary range. Defaults to today.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date — returns just that day, including zero totals if nothing was logged." },
        week_start: { type: "string", description: "ISO Monday date — returns the full Mon–Sun week." },
        date_from: { type: "string", description: "Start of an arbitrary range (ISO date). Use with date_to." },
        date_to: { type: "string", description: "End of an arbitrary range (ISO date, inclusive). Use with date_from." },
      },
    },
  },
  {
    name: "food_log_delete",
    description: "Delete logged food entries, either by entry id or by clearing entire dates.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Specific entry ids to delete." },
        dates: { type: "array", items: { type: "string" }, description: "ISO dates to clear entirely." },
      },
    },
  },
  {
    name: "food_log_log_meal",
    description:
      "Re-log a meal that's already planned or saved in the meal plan by computing its calories/macros from that meal's ingredient list and stored ingredient_macros profiles — avoids retyping a recipe's nutrition by hand. Ingredients with no stored macro profile are skipped and reported back as missing rather than failing the whole entry.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date of the planned/saved meal to source ingredients from (e.g. '2026-05-07')." },
        log_date: { type: "string", description: "ISO date to log the meal against. Defaults to the same date as `date`." },
        meal_category: { type: "string", description: "e.g. 'breakfast', 'lunch', 'dinner', 'snack'. Defaults to 'dinner'." },
      },
      required: ["date"],
    },
  },
];

export async function handleNutritionTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  switch (name) {
    case "ingredient_macros_set": {
      if (typeof args["name"] !== "string" || args["name"].trim() === "") {
        return { content: [{ type: "text", text: "name is required" }], isError: true };
      }
      if (typeof args["calories"] !== "number") {
        return { content: [{ type: "text", text: "calories is required" }], isError: true };
      }
      if (
        args["serving_size"] !== undefined &&
        (typeof args["serving_size"] !== "number" || !Number.isFinite(args["serving_size"]) || args["serving_size"] <= 0)
      ) {
        return { content: [{ type: "text", text: "serving_size must be a positive number" }], isError: true };
      }
      const macros = await upsertIngredientMacros(db, householdId, {
        name: args["name"],
        servingSize: typeof args["serving_size"] === "number" ? args["serving_size"] : undefined,
        servingUnit: typeof args["serving_unit"] === "string" ? args["serving_unit"] : undefined,
        calories: args["calories"],
        proteinG: optionalNumber(args, "protein_g"),
        carbsG: optionalNumber(args, "carbs_g"),
        fatG: optionalNumber(args, "fat_g"),
        fiberG: optionalNumber(args, "fiber_g"),
        saturatedFatG: optionalNumber(args, "saturated_fat_g"),
        sodiumMg: optionalNumber(args, "sodium_mg"),
      });
      return { content: [{ type: "text", text: JSON.stringify(toMacrosData(macros), null, 2) }] };
    }

    case "ingredient_macros_list": {
      const rows = await listIngredientMacros(db, householdId);
      return { content: [{ type: "text", text: JSON.stringify(rows.map(toMacrosData), null, 2) }] };
    }

    case "ingredient_macros_delete": {
      if (typeof args["name"] !== "string") {
        return { content: [{ type: "text", text: "name is required" }], isError: true };
      }
      const deleted = await deleteIngredientMacros(db, householdId, args["name"]);
      return { content: [{ type: "text", text: JSON.stringify({ deleted }) }] };
    }

    case "food_log_add": {
      if (typeof args["date"] !== "string") {
        return { content: [{ type: "text", text: "date is required" }], isError: true };
      }
      if (!Array.isArray(args["entries"]) || args["entries"].length === 0) {
        return { content: [{ type: "text", text: "entries must be a non-empty array" }], isError: true };
      }

      const rawEntries = args["entries"] as unknown[];
      const resolved = await Promise.all(
        rawEntries.map((e, i) =>
          resolveEntry(db, householdId, typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {}, i),
        ),
      );

      const errors = resolved.filter((r): r is { error: string } => "error" in r);
      if (errors.length > 0) {
        return { content: [{ type: "text", text: errors.map((e) => e.error).join("; ") }], isError: true };
      }

      const parsed = resolved.map((r) => (r as { entry: ParsedFoodLogEntry }).entry);
      const saved = await addFoodLogEntries(
        db,
        householdId,
        parsed.map((e) => ({
          date: args["date"] as string,
          mealCategory: e.mealCategory,
          name: e.name,
          quantity: e.quantity,
          unit: e.unit,
          calories: e.calories,
          proteinG: e.proteinG,
          carbsG: e.carbsG,
          fatG: e.fatG,
          fiberG: e.fiberG,
          saturatedFatG: e.saturatedFatG,
          sodiumMg: e.sodiumMg,
        })),
      );

      const entries = saved.map(toEntryData);
      return {
        content: [{ type: "text", text: JSON.stringify({ date: args["date"], entries, totals: sumTotals(entries) }, null, 2) }],
      };
    }

    case "food_log_get": {
      const { date, dateFrom, dateTo } = parseDateRange(args);
      const rows = await getFoodLogEntries(db, householdId, dateFrom, dateTo);

      const byDate = new Map<string, FoodLogEntryData[]>();
      for (const row of rows) {
        const list = byDate.get(row.date) ?? [];
        list.push(toEntryData(row));
        byDate.set(row.date, list);
      }

      if (date !== undefined) {
        const entries = byDate.get(date) ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ date, entries, totals: sumTotals(entries) }, null, 2) }],
        };
      }

      const days = [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, entries]) => ({ date: d, entries, totals: sumTotals(entries) }));

      return { content: [{ type: "text", text: JSON.stringify(days, null, 2) }] };
    }

    case "food_log_delete": {
      const ids = Array.isArray(args["ids"])
        ? (args["ids"] as unknown[]).filter((i): i is string => typeof i === "string")
        : undefined;
      const dates = Array.isArray(args["dates"])
        ? (args["dates"] as unknown[]).filter((d): d is string => typeof d === "string")
        : undefined;

      if ((!ids || ids.length === 0) && (!dates || dates.length === 0)) {
        return { content: [{ type: "text", text: "at least one of ids or dates is required" }], isError: true };
      }

      const deleted = await deleteFoodLogEntries(db, householdId, { ids, dates });
      return { content: [{ type: "text", text: JSON.stringify({ deleted }) }] };
    }

    case "food_log_log_meal": {
      if (typeof args["date"] !== "string") {
        return { content: [{ type: "text", text: "date is required" }], isError: true };
      }
      const meals = await getMealEntries(db, householdId, args["date"], args["date"]);
      if (meals.length === 0) {
        return { content: [{ type: "text", text: `No planned meal found for ${args["date"]}` }], isError: true };
      }
      const meal = meals[0]!;
      const ingredients: MealIngredient[] = meal.ingredients ? JSON.parse(meal.ingredients) : [];
      if (ingredients.length === 0) {
        return {
          content: [{
            type: "text",
            text: `"${meal.name}" on ${args["date"]} has no ingredients to compute calories from — log it manually with food_log_add instead`,
          }],
          isError: true,
        };
      }

      const { totals, found, missing } = await computeMealNutrition(db, householdId, ingredients);
      if (!found.has("calories")) {
        return {
          content: [{
            type: "text",
            text: `None of the ingredients in "${meal.name}" have stored macros — add them via ingredient_macros_set first, or log this meal manually with food_log_add`,
          }],
          isError: true,
        };
      }

      const logDate = typeof args["log_date"] === "string" ? args["log_date"] : meal.date;
      const mealCategory = typeof args["meal_category"] === "string" && args["meal_category"].trim() !== ""
        ? args["meal_category"]
        : "dinner";

      const saved = await addFoodLogEntries(db, householdId, [{
        date: logDate,
        mealCategory,
        name: meal.name,
        calories: totals.calories,
        proteinG: found.has("protein_g") ? totals.protein_g : null,
        carbsG: found.has("carbs_g") ? totals.carbs_g : null,
        fatG: found.has("fat_g") ? totals.fat_g : null,
        fiberG: found.has("fiber_g") ? totals.fiber_g : null,
        saturatedFatG: found.has("saturated_fat_g") ? totals.saturated_fat_g : null,
        sodiumMg: found.has("sodium_mg") ? totals.sodium_mg : null,
      }]);

      const entries = saved.map(toEntryData);
      const result: Record<string, unknown> = { date: logDate, entries, totals: sumTotals(entries) };
      if (missing.length > 0) result["missing_macros_for"] = missing;

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
