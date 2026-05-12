-- Track which OAuth provider initiated each authorization flow.
-- DEFAULT 'github' back-fills any in-flight rows (they expire in 10 min anyway).
ALTER TABLE oauth_states ADD COLUMN provider TEXT NOT NULL DEFAULT 'github';
