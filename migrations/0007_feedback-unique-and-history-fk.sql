-- Remove any duplicate meal_feedback rows before adding unique index
DELETE FROM meal_feedback WHERE id NOT IN (
  SELECT MIN(id) FROM meal_feedback GROUP BY household_id, date, ifnull(meal_snapshot, '')
);

-- Prevent duplicate rows for the same date+meal-version under retries or concurrency.
-- ifnull normalises NULL (no meal entry) so two null-snapshot rows also conflict.
CREATE UNIQUE INDEX idx_meal_feedback_unique
  ON meal_feedback(household_id, date, ifnull(meal_snapshot, ''));

-- Recreate preference_history with a proper FK to households(id)
CREATE TABLE preference_history_v2 (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  preference_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at INTEGER NOT NULL
);

INSERT INTO preference_history_v2 SELECT * FROM preference_history;
DROP TABLE preference_history;
ALTER TABLE preference_history_v2 RENAME TO preference_history;

CREATE INDEX idx_preference_history_household ON preference_history(household_id, preference_key);
