-- Migration number: 0004 	 2026-05-08T08:12:39.966Z

-- Prerequisite: remove duplicate (household_id, name) rows before running.
-- Use scripts/dedup-pantry.sql if any duplicates exist.
CREATE UNIQUE INDEX idx_pantry_unique_name_household
  ON pantry_items(household_id, LOWER(name));
