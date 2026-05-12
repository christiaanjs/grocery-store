-- Canonical schema — apply via migrations, never edit D1 directly

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- GitHub user ID (oauth sub)
  email TEXT CHECK(email IS NULL OR email = lower(email)),
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

CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(household_id, key)
);

CREATE TABLE preference_history (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  preference_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at INTEGER NOT NULL
);

CREATE TABLE meal_feedback (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,
  rating INTEGER,      -- 1-5, nullable
  notes TEXT,
  tags TEXT,           -- JSON: string[]
  meal_snapshot TEXT,  -- JSON snapshot of meal_entries row at feedback creation time
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
  -- uniqueness enforced by idx_meal_feedback_unique (expression index with ifnull)
);

CREATE TABLE oauth_identities (
  provider    TEXT NOT NULL,  -- 'github', 'google', etc.
  provider_id TEXT NOT NULL,  -- provider's user ID (string)
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_id)
);

CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_meal_entries_household_date ON meal_entries(household_id, date);
CREATE INDEX idx_preferences_household ON preferences(household_id);
CREATE INDEX idx_preference_history_household ON preference_history(household_id, preference_key);
CREATE INDEX idx_meal_feedback_household ON meal_feedback(household_id);
CREATE INDEX idx_meal_feedback_date ON meal_feedback(household_id, date);
CREATE UNIQUE INDEX idx_meal_feedback_unique ON meal_feedback(household_id, date, ifnull(meal_snapshot, ''));
