import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { AppEnv } from "../types";
import { createGatewayOpenAI, DEFAULT_MODEL } from "../providers";
import { getMcpServers } from "../mcp/config";
import { withCredentials } from "../mcp";
import { callMcpTool } from "../mcp/raw-loader";
import { redactLog } from "./redact";
import { BugDraftEditsSchema, draftBugReport, issueDescription, type BugDraft } from "./bug-draft";
import { recordProgress, type BugReportResult, type Duplicate } from "./progress";

export const MAX_LOG_CHARS = 20_000;

/** The team's project in the issue tracker (see prompts/system.ts). */
const PROJECT_ID = "proj-demo";

/**
 * Workflow params persist in the instance's history, so they carry only what
 * the run needs to act as the user: never a token (design §7).
 */
export interface BugReportParams {
  log: string;
  note?: string;
  /** Access identity of the user who started it; null in local development. */
  userId: string | null;
  chatId?: string;
}

export interface BugApproval {
  decision: "approve" | "reject";
  edits?: Partial<BugDraft>;
}

type Bindings = AppEnv["Bindings"];

/** Calls one issue-tracker tool with the starting user's credential. */
async function issueTracker(env: Bindings, userId: string | null, name: string, args: Record<string, unknown>) {
  const server = getMcpServers(env).find((s) => s.name === "issue-tracker")!;
  const resolved = await withCredentials(server, {
    env,
    userId,
    local: env.ENVIRONMENT === "development",
  });
  if (!resolved) throw new NonRetryableError("The issue tracker isn't connected for this user");
  const content = await callMcpTool(resolved, name, args);
  return content.map((block) => block.text ?? "").join("");
}

/** The tracker's role refusal, e.g. "Forbidden: requires one of [admin, member]". */
const FORBIDDEN = /Forbidden|requires one of/i;

const STOPWORDS = new Set(["when", "with", "from", "that", "this", "after", "fails", "error", "does", "into"]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

/** Open issues whose titles share enough words with the draft's title. */
export function rankDuplicates(
  draftTitle: string,
  candidates: { id: string; title: string; status: string }[]
): Duplicate[] {
  const target = words(draftTitle);
  const scored = new Map<string, { dup: Duplicate; score: number }>();
  for (const c of candidates) {
    if (c.status === "done" || c.status === "closed" || scored.has(c.id)) continue;
    const other = words(c.title);
    const shared = [...target].filter((w) => other.has(w)).length;
    const score = shared / new Set([...target, ...other]).size;
    if (shared >= 2 || score >= 0.4) scored.set(c.id, { dup: { id: c.id, title: c.title, status: c.status }, score });
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.dup);
}

export class BugReportWorkflow extends WorkflowEntrypoint<Bindings, BugReportParams> {
  async run(event: WorkflowEvent<BugReportParams>, step: WorkflowStep): Promise<BugReportResult> {
    const { log, note, userId, chatId } = event.payload;
    const id = event.instanceId;
    const db = this.env.DB;

    // 1. Mask secrets before anything else sees the log. Pure: no model call.
    const redacted = await step.do("redact", async () => {
      await recordProgress(db, id, { userId, chatId: chatId ?? null, step: "redact" });
      return redactLog(log).text;
    });

    // 2. Structured draft. Off-schema output throws, so the step retries.
    const draft = await step.do(
      "draft",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await recordProgress(db, id, { step: "draft" });
        const model = createGatewayOpenAI(this.env)(DEFAULT_MODEL);
        const result = await draftBugReport({ model, redactedLog: redacted, note });
        await recordProgress(db, id, { draft: result });
        return result;
      }
    );

    // 3. Possible duplicates, shown on the approval card.
    await step.do("dedupe", async () => {
      await recordProgress(db, id, { step: "dedupe" });
      const candidates: { id: string; title: string; status: string }[] = [];
      for (const word of [...words(draft.title)].slice(0, 3)) {
        const text = await issueTracker(this.env, userId, "search_issues", { query: word, project_id: PROJECT_ID });
        candidates.push(...(JSON.parse(text || "[]") as typeof candidates));
      }
      const dupes = rankDuplicates(draft.title, candidates);
      await recordProgress(db, id, { dupes });
      return dupes;
    });

    // 4. Durable pause for the user's decision (survives refreshes and deploys).
    await step.do("await approval", async () => {
      await recordProgress(db, id, { step: "approval" });
    });
    let approval: BugApproval;
    try {
      const event = await step.waitForEvent<BugApproval>("approval", {
        type: "bug-approval",
        timeout: (this.env.BUG_REPORT_APPROVAL_TIMEOUT ?? "24 hours") as "24 hours",
      });
      approval = event.payload;
    } catch {
      return this.finish(step, id, { outcome: "expired" });
    }
    if (approval.decision !== "approve") return this.finish(step, id, { outcome: "rejected" });

    const edits = BugDraftEditsSchema.safeParse(approval.edits ?? {});
    const final: BugDraft = { ...draft, ...(edits.success ? edits.data : {}) };

    // 5. File exactly once: the instance id is the idempotency key, so a
    //    retried step gets the issue it already created.
    try {
      const issue = await step.do(
        "file",
        { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
        async (ctx) => {
          await recordProgress(db, id, { step: "file", draft: final });
          let text: string;
          try {
            text = await issueTracker(this.env, userId, "create_issue", {
              project_id: PROJECT_ID,
              title: final.title,
              description: issueDescription(final),
              priority: final.severity,
              labels: ["bug", final.component],
              external_id: id,
            });
          } catch (error) {
            // A role refusal won't change on retry. Keep NonRetryableError's own
            // name: the runtime recognizes it by name, and a custom one retries.
            if (FORBIDDEN.test(String(error))) throw new NonRetryableError(String(error));
            throw error;
          }
          const created = JSON.parse(text) as { id: string; title: string; replayed?: boolean };
          // Fault injection (local only): lose the response after the issue
          // exists, so the retry shows external_id returning the same issue.
          if (
            this.env.ENVIRONMENT === "development" &&
            this.env.BUG_REPORT_CHAOS === "fail-after-file" &&
            ctx.attempt === 1
          ) {
            throw new Error("chaos: response lost after create_issue");
          }
          return { id: created.id, title: created.title, replayed: created.replayed ?? false };
        }
      );
      return this.finish(step, id, { outcome: "filed", issue });
    } catch (error) {
      if (error instanceof Error && FORBIDDEN.test(error.message)) {
        return this.finish(step, id, {
          outcome: "not-permitted",
          message: "Your issue-tracker role can't create issues (viewers are read-only).",
        });
      }
      throw error;
    }
  }

  /** Records the outcome for the card (as its own step, so it's written once) and returns it. */
  private async finish(step: WorkflowStep, id: string, result: BugReportResult): Promise<BugReportResult> {
    await step.do("record result", async () => {
      await recordProgress(this.env.DB, id, { step: "done", result });
    });
    return result;
  }
}
