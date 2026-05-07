import type { MealEntry, MealFeedback, MealIngredient, PantryItem, Preference, PreferenceHistory, User } from "../types.ts";

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

export async function getMealEntries(
  db: D1Database,
  householdId: string,
  dateFrom: string,
  dateTo: string,
): Promise<MealEntry[]> {
  const result = await db
    .prepare(
      "SELECT * FROM meal_entries WHERE household_id = ? AND date >= ? AND date <= ? ORDER BY date",
    )
    .bind(householdId, dateFrom, dateTo)
    .all<MealEntry>();
  return result.results;
}

export async function upsertMealEntry(
  db: D1Database,
  householdId: string,
  entry: { date: string; name: string; ingredients?: MealIngredient[]; steps?: string[] },
): Promise<MealEntry> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const ingredients = entry.ingredients ? JSON.stringify(entry.ingredients) : null;
  const steps = entry.steps ? JSON.stringify(entry.steps) : null;

  await db
    .prepare(
      `INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, date) DO UPDATE SET
         name = excluded.name,
         ingredients = excluded.ingredients,
         steps = excluded.steps`,
    )
    .bind(id, householdId, entry.date, entry.name, ingredients, steps, now)
    .run();

  const saved = await db
    .prepare("SELECT * FROM meal_entries WHERE household_id = ? AND date = ?")
    .bind(householdId, entry.date)
    .first<MealEntry>();
  return saved!;
}

export async function deleteMealEntries(
  db: D1Database,
  householdId: string,
  dates: string[],
): Promise<number> {
  if (dates.length === 0) return 0;
  const placeholders = dates.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `DELETE FROM meal_entries WHERE household_id = ? AND date IN (${placeholders})`,
    )
    .bind(householdId, ...dates)
    .run();
  return result.meta.changes;
}

// ── Preferences ──────────────────────────────────────────────────────────

export async function listPreferences(
  db: D1Database,
  householdId: string,
  key?: string,
): Promise<Preference[]> {
  let query = "SELECT * FROM preferences WHERE household_id = ?";
  const bindings: unknown[] = [householdId];
  if (key !== undefined) {
    query += " AND key = ?";
    bindings.push(key);
  }
  query += " ORDER BY key";
  const result = await db.prepare(query).bind(...bindings).all<Preference>();
  return result.results;
}

export async function getPreferenceHistory(
  db: D1Database,
  householdId: string,
  key?: string,
): Promise<PreferenceHistory[]> {
  let query = "SELECT * FROM preference_history WHERE household_id = ?";
  const bindings: unknown[] = [householdId];
  if (key !== undefined) {
    query += " AND preference_key = ?";
    bindings.push(key);
  }
  query += " ORDER BY changed_at DESC";
  const result = await db.prepare(query).bind(...bindings).all<PreferenceHistory>();
  return result.results;
}

export async function setPreference(
  db: D1Database,
  householdId: string,
  key: string,
  value: string,
  notes?: string | null,
): Promise<Preference> {
  const now = Date.now();
  const existing = await db
    .prepare("SELECT * FROM preferences WHERE household_id = ? AND key = ?")
    .bind(householdId, key)
    .first<Preference>();

  const histId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO preference_history (id, household_id, preference_key, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(histId, householdId, key, existing?.value ?? null, value, now)
    .run();

  if (existing) {
    await db
      .prepare("UPDATE preferences SET value = ?, notes = ?, updated_at = ? WHERE id = ?")
      .bind(value, notes !== undefined ? notes : existing.notes, now, existing.id)
      .run();
    const updated = await db
      .prepare("SELECT * FROM preferences WHERE id = ?")
      .bind(existing.id)
      .first<Preference>();
    return updated!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO preferences (id, household_id, key, value, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, householdId, key, value, notes ?? null, now)
    .run();

  return { id, household_id: householdId, key, value, notes: notes ?? null, updated_at: now };
}

export async function deletePreference(
  db: D1Database,
  householdId: string,
  key: string,
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT * FROM preferences WHERE household_id = ? AND key = ?")
    .bind(householdId, key)
    .first<Preference>();

  if (!existing) return false;

  const now = Date.now();
  const histId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO preference_history (id, household_id, preference_key, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(histId, householdId, key, existing.value, null, now),
    db
      .prepare("DELETE FROM preferences WHERE household_id = ? AND key = ?")
      .bind(householdId, key),
  ]);
  return true;
}

// ── Meal feedback ────────────────────────────────────────────────────────

export async function upsertMealFeedback(
  db: D1Database,
  householdId: string,
  date: string,
  feedback: { rating?: number; notes?: string; tags?: string[] },
): Promise<MealFeedback> {
  const now = Date.now();
  const tagsJson = feedback.tags !== undefined ? JSON.stringify(feedback.tags) : undefined;

  const existing = await db
    .prepare("SELECT * FROM meal_feedback WHERE household_id = ? AND date = ?")
    .bind(householdId, date)
    .first<MealFeedback>();

  if (existing) {
    // Never overwrite meal_snapshot — it captures what was actually eaten
    await db
      .prepare(
        "UPDATE meal_feedback SET rating = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        feedback.rating !== undefined ? feedback.rating : existing.rating,
        feedback.notes !== undefined ? feedback.notes : existing.notes,
        tagsJson !== undefined ? tagsJson : existing.tags,
        now,
        existing.id,
      )
      .run();
    const updated = await db
      .prepare("SELECT * FROM meal_feedback WHERE id = ?")
      .bind(existing.id)
      .first<MealFeedback>();
    return updated!;
  }

  // Snapshot the meal entry at creation time so feedback stays valid after edits
  const mealEntry = await db
    .prepare("SELECT name, ingredients, steps FROM meal_entries WHERE household_id = ? AND date = ?")
    .bind(householdId, date)
    .first<{ name: string; ingredients: string | null; steps: string | null }>();
  const mealSnapshot = mealEntry ? JSON.stringify(mealEntry) : null;

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO meal_feedback (id, household_id, date, rating, notes, tags, meal_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, householdId, date, feedback.rating ?? null, feedback.notes ?? null, tagsJson ?? null, mealSnapshot, now, now)
    .run();

  return {
    id,
    household_id: householdId,
    date,
    rating: feedback.rating ?? null,
    notes: feedback.notes ?? null,
    tags: tagsJson ?? null,
    meal_snapshot: mealSnapshot,
    created_at: now,
    updated_at: now,
  };
}

export interface MealSearchRow {
  date: string;
  name: string;
  ingredients: string | null;
  steps: string | null;
  rating: number | null;
  feedback_notes: string | null;
  tags: string | null;
  meal_snapshot: string | null;
}

export async function searchMeals(
  db: D1Database,
  householdId: string,
  opts: { query?: string; minRating?: number; maxRating?: number; tag?: string },
): Promise<MealSearchRow[]> {
  let sql = `
    SELECT me.date, me.name, me.ingredients, me.steps,
           mf.rating, mf.notes AS feedback_notes, mf.tags, mf.meal_snapshot
    FROM meal_entries me
    LEFT JOIN meal_feedback mf ON me.household_id = mf.household_id AND me.date = mf.date
    WHERE me.household_id = ?
  `;
  const bindings: unknown[] = [householdId];

  if (opts.query) {
    const like = `%${opts.query}%`;
    sql += " AND (me.name LIKE ? OR me.ingredients LIKE ? OR mf.notes LIKE ?)";
    bindings.push(like, like, like);
  }
  if (opts.minRating !== undefined) {
    sql += " AND mf.rating >= ?";
    bindings.push(opts.minRating);
  }
  if (opts.maxRating !== undefined) {
    sql += " AND mf.rating <= ?";
    bindings.push(opts.maxRating);
  }
  if (opts.tag) {
    sql += ` AND mf.tags LIKE ?`;
    bindings.push(`%"${opts.tag}"%`);
  }
  sql += " ORDER BY me.date DESC LIMIT 50";

  const result = await db.prepare(sql).bind(...bindings).all<MealSearchRow>();
  return result.results;
}
