-- Migration number: 0001 	 2026-05-06T10:07:09.531Z

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  household_id TEXT NOT NULL REFERENCES households(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  category TEXT,
  quantity REAL,
  unit TEXT,
  in_stock INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  week_start TEXT NOT NULL,
  meals TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meals_household_week ON meal_plans(household_id, week_start);
