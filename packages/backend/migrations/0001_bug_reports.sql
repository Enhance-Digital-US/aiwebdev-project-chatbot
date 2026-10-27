-- Progress of each bug-report workflow run, for the workflow card.
-- Workflows' instance.status() only reports running/complete; the current
-- step, the draft and the duplicates live here (design §7).
CREATE TABLE IF NOT EXISTS bug_reports (
  instance_id TEXT PRIMARY KEY,
  user_id     TEXT,             -- Access identity of the starter; NULL locally
  chat_id     TEXT,
  step        TEXT NOT NULL,    -- redact | draft | dedupe | approval | file | done
  draft       TEXT,             -- BugDraft JSON
  dupes       TEXT,             -- Duplicate[] JSON
  result      TEXT,             -- BugReportResult JSON, once finished
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bug_reports_chat ON bug_reports (chat_id);
