import type { BugDraft } from "./bug-draft";

export type BugReportStep = "redact" | "draft" | "dedupe" | "approval" | "file" | "done";

export interface Duplicate {
  id: string;
  title: string;
  status: string;
}

export type BugReportResult =
  | { outcome: "filed"; issue: { id: string; title: string; replayed: boolean } }
  | { outcome: "rejected" }
  | { outcome: "expired" }
  | { outcome: "not-permitted"; message: string };

export interface BugReportProgress {
  instanceId: string;
  userId: string | null;
  chatId: string | null;
  step: BugReportStep;
  draft: BugDraft | null;
  dupes: Duplicate[] | null;
  result: BugReportResult | null;
}

/** Upserts the run's row. Only the given fields change, so retried steps can rewrite freely. */
export async function recordProgress(
  db: D1Database,
  instanceId: string,
  update: Partial<Omit<BugReportProgress, "instanceId">>
): Promise<void> {
  const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
  await db
    .prepare(
      `INSERT INTO bug_reports (instance_id, user_id, chat_id, step, draft, dupes, result, updated_at)
       VALUES (?1, ?2, ?3, COALESCE(?4, 'redact'), ?5, ?6, ?7, ?8)
       ON CONFLICT (instance_id) DO UPDATE SET
         user_id = COALESCE(?2, user_id),
         chat_id = COALESCE(?3, chat_id),
         step    = COALESCE(?4, step),
         draft   = COALESCE(?5, draft),
         dupes   = COALESCE(?6, dupes),
         result  = COALESCE(?7, result),
         updated_at = ?8`
    )
    .bind(
      instanceId,
      update.userId ?? null,
      update.chatId ?? null,
      update.step ?? null,
      json(update.draft),
      json(update.dupes),
      json(update.result),
      Date.now()
    )
    .run();
}

export async function readProgress(db: D1Database, instanceId: string): Promise<BugReportProgress | null> {
  const row = await db
    .prepare("SELECT * FROM bug_reports WHERE instance_id = ?")
    .bind(instanceId)
    .first<{
      instance_id: string;
      user_id: string | null;
      chat_id: string | null;
      step: BugReportStep;
      draft: string | null;
      dupes: string | null;
      result: string | null;
    }>();
  if (!row) return null;
  const parse = <T>(v: string | null) => (v ? (JSON.parse(v) as T) : null);
  return {
    instanceId: row.instance_id,
    userId: row.user_id,
    chatId: row.chat_id,
    step: row.step,
    draft: parse(row.draft),
    dupes: parse(row.dupes),
    result: parse(row.result),
  };
}
