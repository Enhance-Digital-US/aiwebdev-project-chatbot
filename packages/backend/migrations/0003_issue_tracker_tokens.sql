-- Each user's issue-tracker OAuth tokens (design §9), when deployed or with
-- ISSUE_TRACKER_AUTH=oauth. Both tokens are AES-GCM encrypted with
-- TOKEN_ENCRYPTION_KEY and bound to user_id, and never sent to the browser.
-- client_id is kept because a refresh must use the client that was authorized
-- (with dynamic registration, each connect gets a new one).
CREATE TABLE issue_tracker_tokens (
  user_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  -- ms since epoch
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
