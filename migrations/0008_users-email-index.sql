-- Index for email-based user lookup (account linking during OAuth)
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
