-- Migration number: 0003 	 2026-05-06T12:00:00.000Z
-- All expires_at columns use Unix milliseconds (Date.now())

-- Pending OAuth states (created at /authorize, consumed at /oauth/callback)
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  original_state TEXT,
  expires_at INTEGER NOT NULL -- Unix milliseconds
);

-- DCR-registered OAuth clients (public clients; no client_secret)
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uris TEXT NOT NULL, -- JSON array
  created_at INTEGER NOT NULL
);

-- Short-lived MCP authorization codes (consumed once at /token)
CREATE TABLE oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL, -- Unix milliseconds
  used INTEGER NOT NULL DEFAULT 0
);

-- Refresh tokens (stored as SHA-256 hashes, rotated on each use)
CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL, -- Unix milliseconds
  revoked INTEGER NOT NULL DEFAULT 0
);
