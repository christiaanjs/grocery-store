export interface IntegrationRow {
  id: string;
  household_id: string;
  provider: string;
  encrypted_token: string;
  token_iv: string;
  google_email: string | null;
  keep_list_id: string | null;
  created_at: number;
  updated_at: number;
}

export async function getIntegration(
  db: D1Database,
  householdId: string,
  provider: string,
): Promise<IntegrationRow | null> {
  return db
    .prepare("SELECT * FROM integrations WHERE household_id = ? AND provider = ?")
    .bind(householdId, provider)
    .first<IntegrationRow>();
}

export async function upsertIntegration(
  db: D1Database,
  householdId: string,
  provider: string,
  encryptedToken: string,
  tokenIv: string,
  googleEmail: string | null,
): Promise<void> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO integrations (id, household_id, provider, encrypted_token, token_iv, google_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, provider) DO UPDATE SET
         encrypted_token = excluded.encrypted_token,
         token_iv = excluded.token_iv,
         google_email = COALESCE(excluded.google_email, google_email),
         updated_at = excluded.updated_at`,
    )
    .bind(id, householdId, provider, encryptedToken, tokenIv, googleEmail, now, now)
    .run();
}

export async function updateIntegrationKeepList(
  db: D1Database,
  householdId: string,
  provider: string,
  keepListId: string | null,
): Promise<void> {
  await db
    .prepare(
      "UPDATE integrations SET keep_list_id = ?, updated_at = ? WHERE household_id = ? AND provider = ?",
    )
    .bind(keepListId, Date.now(), householdId, provider)
    .run();
}

export async function deleteIntegration(
  db: D1Database,
  householdId: string,
  provider: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM integrations WHERE household_id = ? AND provider = ?")
    .bind(householdId, provider)
    .run();
}

export async function insertIntegrationAuthState(
  db: D1Database,
  state: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO integration_auth_states (state, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(state, userId, expiresAt)
    .run();
}

export async function getAndDeleteIntegrationAuthState(
  db: D1Database,
  state: string,
): Promise<{ user_id: string; expires_at: number } | null> {
  const row = await db
    .prepare("SELECT user_id, expires_at FROM integration_auth_states WHERE state = ?")
    .bind(state)
    .first<{ user_id: string; expires_at: number }>();
  if (row) {
    await db
      .prepare("DELETE FROM integration_auth_states WHERE state = ?")
      .bind(state)
      .run();
  }
  return row;
}
