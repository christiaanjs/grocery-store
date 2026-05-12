-- Normalize all existing emails to lowercase and switch the unique index to lower(email).
UPDATE users SET email = lower(email) WHERE email IS NOT NULL;

DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users(lower(email)) WHERE email IS NOT NULL;
