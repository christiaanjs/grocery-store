-- Run before migration 0004 if duplicates exist.
-- Check first: SELECT household_id, LOWER(name), COUNT(*) FROM pantry_items GROUP BY 1, 2 HAVING COUNT(*) > 1
--
-- Keeps the most recently updated row per (household_id, name).
-- Ties in updated_at are broken by MIN(id) (arbitrary but deterministic).
--
-- Local dev:
--   npx wrangler d1 execute grocery-store-db --local --file scripts/dedup-pantry.sql
-- Production (only after reviewing duplicates):
--   npx wrangler d1 execute grocery-store-db --file scripts/dedup-pantry.sql

DELETE FROM pantry_items
WHERE id NOT IN (
  SELECT MIN(p.id)
  FROM pantry_items p
  INNER JOIN (
    SELECT household_id, LOWER(name) AS lname, MAX(updated_at) AS max_ts
    FROM pantry_items
    GROUP BY household_id, LOWER(name)
  ) latest
    ON LOWER(p.name) = latest.lname
   AND p.household_id = latest.household_id
   AND p.updated_at = latest.max_ts
  GROUP BY p.household_id, LOWER(p.name)
);
