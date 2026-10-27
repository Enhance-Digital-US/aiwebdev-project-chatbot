import { tool } from "ai";
import { z } from "zod";
import type { AppEnv } from "../types";
import { MAX_LOG_CHARS } from "../workflows/bug-report";
import { recordProgress } from "../workflows/progress";

/**
 * Whether the issue tracker's own tools loaded on this request. Every step
 * after the draft talks to the tracker, so `fileBugReport` is only offered
 * when they did; otherwise a run would report "started" and then fail at the
 * duplicate check.
 */
export function issueTrackerLoaded(mcpTools: Record<string, unknown>): boolean {
  return Object.keys(mcpTools).some((name) => name.startsWith("issue-tracker_"));
}

/**
 * Starts the durable bug-report workflow and returns at once: the draft,
 * the duplicate check and the user's approval happen in the workflow, and
 * the chat shows a card that follows it by instance id.
 */
export function createFileBugReportTool(
  env: AppEnv["Bindings"],
  { userId, chatId }: { userId: string | null; chatId?: string }
) {
  return tool({
    description:
      "File a bug report from an error log or stack trace the user pasted. Starts a workflow that redacts secrets, drafts the report, checks for duplicates and waits for the user to approve it before filing. Pass the log verbatim.",
    inputSchema: z.object({
      log: z
        .string()
        .min(1)
        .max(MAX_LOG_CHARS, `The log is longer than ${MAX_LOG_CHARS} characters; ask the user for the relevant part.`)
        .describe("The pasted log, verbatim"),
      note: z.string().max(500).optional().describe("Anything the user said about the failure"),
    }),
    execute: async ({ log, note }) => {
      const id = crypto.randomUUID();
      // The card polls GET /api/workflows/:id as soon as it sees this id, but the
      // first step can start seconds later. Without the row, that first poll is
      // a 404 and the card gives up on a run that's fine. Written before
      // create(), so it can't overwrite steps the run has already recorded.
      await recordProgress(env.DB, id, { userId, chatId: chatId ?? null, step: "redact" });
      let instance: { id: string };
      try {
        instance = await env.BUG_REPORT.create({ id, params: { log, note, userId, chatId } });
      } catch (error) {
        await env.DB.prepare("DELETE FROM bug_reports WHERE instance_id = ?").bind(id).run();
        throw error;
      }
      return {
        instanceId: instance.id,
        message: "Bug report started. The user will review the draft on the card and approve or reject it.",
      };
    },
  });
}
