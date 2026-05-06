import type { MealPlan, PantryItem, User } from "../types.ts";

// ── Users / households ───────────────────────────────────────────────────

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

export async function createUserWithHousehold(
  db: D1Database,
  userId: string,
  email: string | null,
): Promise<string> {
  const householdId = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)")
      .bind(householdId, "My Household", now),
    db
      .prepare("INSERT INTO users (id, email, household_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(userId, email, householdId, now),
  ]);
  return householdId;
}

export async function getOrCreateHousehold(db: D1Database, userId: string): Promise<string> {
  const user = await getUser(db, userId);
  if (user) return user.household_id;
  return createUserWithHousehold(db, userId, null);
}

// ── Pantry ───────────────────────────────────────────────────────────────

export async function listPantryItems(
  db: D1Database,
  householdId: string,
  opts: { category?: string; inStock?: boolean } = {},
): Promise<PantryItem[]> {
  let query = "SELECT * FROM pantry_items WHERE household_id = ?";
  const bindings: unknown[] = [householdId];

  if (opts.category !== undefined) {
    query += " AND category = ?";
    bindings.push(opts.category);
  }
  if (opts.inStock !== undefined) {
    query += " AND in_stock = ?";
    bindings.push(opts.inStock ? 1 : 0);
  }
  query += " ORDER BY name";

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<PantryItem>();
  return result.results;
}

export async function upsertPantryItem(
  db: D1Database,
  householdId: string,
  item: {
    name: string;
    category?: string | null;
    quantity?: number | null;
    unit?: string | null;
    inStock?: boolean;
  },
): Promise<PantryItem> {
  const now = Date.now();
  const existing = await db
    .prepare("SELECT * FROM pantry_items WHERE household_id = ? AND name = ?")
    .bind(householdId, item.name)
    .first<PantryItem>();

  if (existing) {
    await db
      .prepare(
        "UPDATE pantry_items SET category = ?, quantity = ?, unit = ?, in_stock = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        item.category !== undefined ? item.category : existing.category,
        item.quantity !== undefined ? item.quantity : existing.quantity,
        item.unit !== undefined ? item.unit : existing.unit,
        item.inStock !== undefined ? (item.inStock ? 1 : 0) : existing.in_stock,
        now,
        existing.id,
      )
      .run();
    const updated = await db
      .prepare("SELECT * FROM pantry_items WHERE id = ?")
      .bind(existing.id)
      .first<PantryItem>();
    return updated!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO pantry_items (id, household_id, name, category, quantity, unit, in_stock, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      householdId,
      item.name,
      item.category ?? null,
      item.quantity ?? null,
      item.unit ?? null,
      item.inStock !== undefined ? (item.inStock ? 1 : 0) : 1,
      now,
    )
    .run();

  return {
    id,
    household_id: householdId,
    name: item.name,
    category: item.category ?? null,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    in_stock: (item.inStock !== false ? 1 : 0) as 0 | 1,
    updated_at: now,
  };
}

export async function markPantryItemsOut(
  db: D1Database,
  householdId: string,
  names: string[],
): Promise<number> {
  if (names.length === 0) return 0;
  const placeholders = names.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `UPDATE pantry_items SET in_stock = 0, updated_at = ? WHERE household_id = ? AND name IN (${placeholders})`,
    )
    .bind(Date.now(), householdId, ...names)
    .run();
  return result.meta.changes;
}

// ── Meals ────────────────────────────────────────────────────────────────

export async function getMealPlan(
  db: D1Database,
  householdId: string,
  weekStart: string,
): Promise<MealPlan | null> {
  return db
    .prepare("SELECT * FROM meal_plans WHERE household_id = ? AND week_start = ?")
    .bind(householdId, weekStart)
    .first<MealPlan>();
}

export async function upsertMealPlan(
  db: D1Database,
  householdId: string,
  weekStart: string,
  meals: Record<string, string | undefined>,
): Promise<MealPlan> {
  const now = Date.now();
  const existing = await getMealPlan(db, householdId, weekStart);

  if (existing) {
    const merged = { ...(JSON.parse(existing.meals) as Record<string, string>), ...meals };
    const mealsJson = JSON.stringify(merged);
    await db
      .prepare("UPDATE meal_plans SET meals = ? WHERE id = ?")
      .bind(mealsJson, existing.id)
      .run();
    return { ...existing, meals: mealsJson };
  }

  const id = crypto.randomUUID();
  const mealsJson = JSON.stringify(meals);
  await db
    .prepare(
      "INSERT INTO meal_plans (id, household_id, week_start, meals, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, householdId, weekStart, mealsJson, now)
    .run();

  return { id, household_id: householdId, week_start: weekStart, meals: mealsJson, created_at: now };
}
