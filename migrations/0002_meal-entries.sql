-- Migration number: 0002 	 2026-05-07T00:00:00.000Z

CREATE TABLE meal_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,          -- ISO date of the actual day, e.g. '2026-05-07'
  name TEXT NOT NULL,
  ingredients TEXT,            -- JSON: [{name, quantity?, unit?}]
  steps TEXT,                  -- JSON: string[]
  created_at INTEGER NOT NULL,
  UNIQUE(household_id, date)
);

CREATE INDEX idx_meal_entries_household_date ON meal_entries(household_id, date);

-- Migrate existing meal_plans rows. Each row's meals blob is
-- { mon: "...", tue: "...", ... } — expand to one row per day.
INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+0 days'), json_extract(meals, '$.mon'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.mon') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+1 days'), json_extract(meals, '$.tue'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.tue') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+2 days'), json_extract(meals, '$.wed'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.wed') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+3 days'), json_extract(meals, '$.thu'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.thu') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+4 days'), json_extract(meals, '$.fri'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.fri') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+5 days'), json_extract(meals, '$.sat'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.sat') IS NOT NULL;

INSERT INTO meal_entries (id, household_id, date, name, ingredients, steps, created_at)
SELECT lower(hex(randomblob(16))), household_id, date(week_start, '+6 days'), json_extract(meals, '$.sun'), NULL, NULL, created_at FROM meal_plans WHERE json_extract(meals, '$.sun') IS NOT NULL;

DROP TABLE meal_plans;
