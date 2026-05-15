-- Temporary state for the integration OAuth handshake
CREATE TABLE integration_auth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Stored integrations with encrypted credentials
CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_token TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    google_email TEXT,
    keep_list_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(household_id, provider)
);

CREATE INDEX idx_integrations_household ON integrations(household_id);
