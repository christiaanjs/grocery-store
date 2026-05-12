-- Add a unique index on email (partial: NULL emails are exempt).
-- If duplicate emails exist, resolve them manually before running this migration.
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
