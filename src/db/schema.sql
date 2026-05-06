-- Canonical schema — apply via migrations, never edit D1 directly

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- GitHub user ID (oauth sub)
  email TEXT,
  household_id TEXT NOT NULL REFERENCES households(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  category TEXT,                -- 'produce', 'dairy', 'pantry', etc.
  quantity REAL,
  unit TEXT,                    -- 'g', 'ml', 'count', etc.
  in_stock INTEGER NOT NULL DEFAULT 1,  -- 0 = run out
  updated_at INTEGER NOT NULL
);

CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  week_start TEXT NOT NULL,     -- ISO date, Monday of the week
  meals TEXT NOT NULL,          -- JSON blob: { mon: "...", tue: "...", ... }
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meals_household_week ON meal_plans(household_id, week_start);
