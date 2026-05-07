-- User/household preferences with change history
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(household_id, key)
);

-- Append-only log of every preference create/update/delete
CREATE TABLE preference_history (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  old_value TEXT,    -- NULL when first created
  new_value TEXT,    -- NULL when deleted
  changed_at INTEGER NOT NULL
);

-- Per-day meal feedback (rating, notes, tags)
CREATE TABLE meal_feedback (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,
  rating INTEGER,    -- 1-5, nullable
  notes TEXT,
  tags TEXT,         -- JSON: string[]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(household_id, date)
);

CREATE INDEX idx_preferences_household ON preferences(household_id);
CREATE INDEX idx_preference_history_household ON preference_history(household_id, preference_key);
CREATE INDEX idx_meal_feedback_household ON meal_feedback(household_id);
