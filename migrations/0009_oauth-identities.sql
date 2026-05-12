-- Provider-to-user identity mapping enabling multiple OAuth providers per account
CREATE TABLE oauth_identities (
  provider    TEXT NOT NULL,  -- 'github', 'google', etc.
  provider_id TEXT NOT NULL,  -- provider's user ID (string)
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_id)
);

CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);

-- Back-fill existing GitHub users whose id is in the form 'github:{numeric_id}'
-- substr(..., 8) strips the 7-character 'github:' prefix (SQLite substr is 1-indexed)
INSERT INTO oauth_identities (provider, provider_id, user_id, created_at)
SELECT 'github', substr(id, 8), id, created_at
FROM users
WHERE id LIKE 'github:%';
