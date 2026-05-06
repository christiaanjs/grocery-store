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

CREATE TABLE meal_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,           -- ISO date of the actual day, e.g. '2026-05-07'
  name TEXT NOT NULL,
  ingredients TEXT,             -- JSON: [{name, quantity?, unit?}]
  steps TEXT,                   -- JSON: string[]
  created_at INTEGER NOT NULL,
  UNIQUE(household_id, date)
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meal_entries_household_date ON meal_entries(household_id, date);
