-- Saved conversations (design §8). The chat id is chosen by the client
-- (useChat), so user_id is set on first save and checked on every request.
CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,     -- Access identity; "local" in local development
  title       TEXT,              -- from the first answer's follow-ups; untitled chats stay out of the sidebar
  token_total INTEGER NOT NULL DEFAULT 0,  -- every model call the chat made, for CHAT_TOKEN_CAP
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS chats_user ON chats (user_id, updated_at DESC);

-- One row per UI message, in order. A save rewrites the rows from seq 0, so
-- a continued message (after a confirmation) replaces its earlier version.
CREATE TABLE IF NOT EXISTS messages (
  chat_id    TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  ui_message TEXT NOT NULL,      -- UIMessage JSON, parts and metadata included
  PRIMARY KEY (chat_id, seq)
);

-- Workflows link to their chat through bug_reports.chat_id (0001).
