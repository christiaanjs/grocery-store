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

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email.toLowerCase()).first<User>();
}

export async function updateUserEmail(db: D1Database, userId: string, email: string): Promise<void> {
  await db
    .prepare("UPDATE users SET email = ? WHERE id = ? AND email IS NULL")
    .bind(email.toLowerCase(), userId)
    .run();
}

// ── OAuth identities ─────────────────────────────────────────────────────

export interface OAuthIdentityRow {
  provider: string;
  provider_id: string;
  user_id: string;
  created_at: number;
}

export async function getIdentity(
  db: D1Database,
  provider: string,
  providerId: string,
): Promise<OAuthIdentityRow | null> {
  return db
    .prepare("SELECT * FROM oauth_identities WHERE provider = ? AND provider_id = ?")
    .bind(provider, providerId)
    .first<OAuthIdentityRow>();
}

export async function linkIdentity(
  db: D1Database,
  provider: string,
  providerId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO oauth_identities (provider, provider_id, user_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(provider, providerId, userId, Date.now())
    .run();
}

export async function createUserWithIdentity(
  db: D1Database,
  provider: string,
  providerId: string,
  email: string | null,
): Promise<string> {
  const userId = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const now = Date.now();
  const normalizedEmail = email ? email.toLowerCase() : null;
  await db.batch([
    db
      .prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)")
      .bind(householdId, "My Household", now),
    db
      .prepare("INSERT INTO users (id, email, household_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(userId, normalizedEmail, householdId, now),
    db
      .prepare(
        "INSERT INTO oauth_identities (provider, provider_id, user_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(provider, providerId, userId, now),
  ]);
  return userId;
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
    .prepare("SELECT * FROM pantry_items WHERE household_id = ? AND lower(name) = lower(?)")
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

export async function deletePantryItem(
  db: D1Database,
  householdId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM pantry_items WHERE household_id = ? AND name = ?")
    .bind(householdId, name)
    .run();
  return result.meta.changes > 0;
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

export async function getMealFeedbackForDate(
  db: D1Database,
  householdId: string,
  date: string,
): Promise<MealFeedback | null> {
  const mealEntry = await db
    .prepare("SELECT name, ingredients, steps FROM meal_entries WHERE household_id = ? AND date = ?")
    .bind(householdId, date)
    .first<{ name: string; ingredients: string | null; steps: string | null }>();
  if (!mealEntry) return null;
  const currentSnapshot = JSON.stringify({
    name: mealEntry.name,
    ingredients: mealEntry.ingredients,
    steps: mealEntry.steps,
  });
  return db
    .prepare("SELECT * FROM meal_feedback WHERE household_id = ? AND date = ? AND meal_snapshot = ?")
    .bind(householdId, date, currentSnapshot)
    .first<MealFeedback>();
}

export async function upsertMealFeedback(
  db: D1Database,
  householdId: string,
  date: string,
  feedback: { rating?: number; notes?: string; tags?: string[] },
): Promise<MealFeedback> {
  const now = Date.now();
  const tagsJson = feedback.tags !== undefined ? JSON.stringify(feedback.tags) : undefined;

  // Snapshot the current meal entry to use as the match key
  const mealEntry = await db
    .prepare("SELECT name, ingredients, steps FROM meal_entries WHERE household_id = ? AND date = ?")
    .bind(householdId, date)
    .first<{ name: string; ingredients: string | null; steps: string | null }>();
  const currentSnapshot = mealEntry
    ? JSON.stringify({ name: mealEntry.name, ingredients: mealEntry.ingredients, steps: mealEntry.steps })
    : null;

  // Find existing feedback whose snapshot matches the current meal (same meal = edit, different = new record)
  const existing = currentSnapshot !== null
    ? await db
        .prepare("SELECT * FROM meal_feedback WHERE household_id = ? AND date = ? AND meal_snapshot = ?")
        .bind(householdId, date, currentSnapshot)
        .first<MealFeedback>()
    : await db
        .prepare("SELECT * FROM meal_feedback WHERE household_id = ? AND date = ? AND meal_snapshot IS NULL")
        .bind(householdId, date)
        .first<MealFeedback>();

  if (existing) {
    // Same meal — update the existing feedback row; snapshot is never overwritten
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

  // Meal has changed (or no existing feedback) — create a new record
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO meal_feedback (id, household_id, date, rating, notes, tags, meal_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, householdId, date, feedback.rating ?? null, feedback.notes ?? null, tagsJson ?? null, currentSnapshot, now, now)
    .run();

  return {
    id,
    household_id: householdId,
    date,
    rating: feedback.rating ?? null,
    notes: feedback.notes ?? null,
    tags: tagsJson ?? null,
    meal_snapshot: currentSnapshot,
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
  notes: string | null;       // feedback notes (consistent with meal_feedback_set response)
  tags: string | null;
  meal_snapshot: string | null;
}

export async function searchMeals(
  db: D1Database,
  householdId: string,
  opts: { query?: string; minRating?: number; maxRating?: number; tag?: string },
): Promise<MealSearchRow[]> {
  // Two-query approach to avoid correlated subqueries:
  // 1. Fetch all meal entries for the household (recent first)
  // 2. Fetch all their feedback in a single IN query
  // 3. Match and filter in application code so feedback notes are also searchable

  // Limit the initial fetch to avoid hitting SQLite's bind-parameter cap (999)
  // when building the follow-up IN clause. 500 covers ~1.5 years of daily meals.
  const mealRows = (
    await db
      .prepare(
        "SELECT date, name, ingredients, steps FROM meal_entries WHERE household_id = ? ORDER BY date DESC LIMIT 500",
      )
      .bind(householdId)
      .all<{ date: string; name: string; ingredients: string | null; steps: string | null }>()
  ).results;

  if (mealRows.length === 0) return [];

  const dates = mealRows.map((m) => m.date);
  const feedbackRows = (
    await db
      .prepare(
        `SELECT * FROM meal_feedback WHERE household_id = ? AND date IN (${dates.map(() => "?").join(", ")}) ORDER BY updated_at DESC`,
      )
      .bind(householdId, ...dates)
      .all<MealFeedback>()
  ).results;

  // Group all feedback rows by date
  const feedbackByDate = new Map<string, MealFeedback[]>();
  for (const fb of feedbackRows) {
    const list = feedbackByDate.get(fb.date) ?? [];
    list.push(fb);
    feedbackByDate.set(fb.date, list);
  }

  const queryLower = opts.query?.toLowerCase();
  const results: MealSearchRow[] = [];

  for (const meal of mealRows) {
    // Build the canonical snapshot string for this meal row (same method as upsertMealFeedback)
    const currentSnapshotJson = JSON.stringify({
      name: meal.name,
      ingredients: meal.ingredients,
      steps: meal.steps,
    });

    // Only match feedback whose snapshot equals the current meal exactly.
    // No fallback: stale feedback from a prior meal version is not shown.
    const fb = (feedbackByDate.get(meal.date) ?? []).find(
      (f) => f.meal_snapshot === currentSnapshotJson,
    ) ?? null;

    // Text search covers meal name, ingredients JSON, and matching feedback notes
    if (queryLower) {
      const nameMatch = meal.name.toLowerCase().includes(queryLower);
      const ingMatch = meal.ingredients?.toLowerCase().includes(queryLower) ?? false;
      const notesMatch = fb?.notes?.toLowerCase().includes(queryLower) ?? false;
      if (!nameMatch && !ingMatch && !notesMatch) continue;
    }

    // Rating and tag filters require matching feedback with a value
    if (opts.minRating !== undefined && (fb?.rating ?? null) === null) continue;
    if (opts.minRating !== undefined && fb!.rating! < opts.minRating) continue;
    if (opts.maxRating !== undefined && (fb?.rating ?? null) === null) continue;
    if (opts.maxRating !== undefined && fb!.rating! > opts.maxRating) continue;

    if (opts.tag) {
      if (!fb?.tags) continue;
      try {
        if (!(JSON.parse(fb.tags) as string[]).includes(opts.tag)) continue;
      } catch {
        continue;
      }
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
