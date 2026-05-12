-- Remove any duplicate emails before adding the unique constraint.
-- Keeps the earliest-inserted account (lowest rowid) per email; also cleans up its identities.
-- In practice the email-based linking logic prevents duplicates, but this is a safety net.
DELETE FROM oauth_identities
WHERE user_id IN (
  SELECT id FROM users
  WHERE email IS NOT NULL
    AND rowid NOT IN (
      SELECT MIN(rowid) FROM users WHERE email IS NOT NULL GROUP BY email
    )
);

DELETE FROM users
WHERE email IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM users WHERE email IS NOT NULL GROUP BY email
  );

-- Replace the non-unique index with a unique one.
-- The partial (WHERE email IS NOT NULL) clause lets multiple NULL-email rows coexist.
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
