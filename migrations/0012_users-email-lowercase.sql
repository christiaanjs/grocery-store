-- Normalize all existing emails to lowercase.
UPDATE users SET email = lower(email) WHERE email IS NOT NULL;

-- oauth_identities has a FK on users(id), so we must drop it before rebuilding users.
-- Save the data first, then restore after.
CREATE TABLE oauth_identities_backup AS SELECT * FROM oauth_identities;
DROP TABLE oauth_identities;

-- Rebuild users with CHECK constraint (SQLite ALTER TABLE does not support ADD CONSTRAINT).
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT CHECK(email IS NULL OR email = lower(email)),
  household_id TEXT NOT NULL REFERENCES households(id),
  created_at INTEGER NOT NULL
);
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Restore oauth_identities and its indexes.
CREATE TABLE oauth_identities (
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
INSERT INTO oauth_identities SELECT * FROM oauth_identities_backup;
DROP TABLE oauth_identities_backup;
CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);

-- Recreate the partial unique index (plain column — app always stores lower-case).
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
