CREATE TABLE ingredient_macros (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  serving_size REAL NOT NULL DEFAULT 100,
  serving_unit TEXT NOT NULL DEFAULT 'g',
  calories REAL NOT NULL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE food_log_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,
  meal_category TEXT NOT NULL DEFAULT 'other',
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  calories REAL NOT NULL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_ingredient_macros_unique_name ON ingredient_macros(household_id, LOWER(name));
CREATE INDEX idx_food_log_household_date ON food_log_entries(household_id, date);
