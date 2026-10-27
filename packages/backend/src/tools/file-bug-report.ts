import { tool } from "ai";
import { z } from "zod";
import type { AppEnv } from "../types";
import { MAX_LOG_CHARS } from "../workflows/bug-report";

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
      const instance = await env.BUG_REPORT.create({ params: { log, note, userId, chatId } });
      return {
        instanceId: instance.id,
        message: "Bug report started. The user will review the draft on the card and approve or reject it.",
      };
    },
  });
}
