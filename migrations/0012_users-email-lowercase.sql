-- Normalize all existing emails to lowercase.
UPDATE users SET email = lower(email) WHERE email IS NOT NULL;

-- Add CHECK constraint enforcing lowercase emails.
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so recreate the table.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT CHECK(email IS NULL OR email = lower(email)),
  household_id TEXT NOT NULL REFERENCES households(id),
  created_at INTEGER NOT NULL
);
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate the partial unique index (plain column — app always stores lower-case).
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
