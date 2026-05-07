-- Allow multiple feedback records per date, one per meal version.
-- SQLite cannot DROP CONSTRAINT so recreate the table without UNIQUE(household_id, date).
CREATE TABLE meal_feedback_v2 (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,
  rating INTEGER,
  notes TEXT,
  tags TEXT,
  meal_snapshot TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO meal_feedback_v2 SELECT * FROM meal_feedback;
DROP TABLE meal_feedback;
ALTER TABLE meal_feedback_v2 RENAME TO meal_feedback;

CREATE INDEX idx_meal_feedback_household ON meal_feedback(household_id);
CREATE INDEX idx_meal_feedback_date ON meal_feedback(household_id, date);
