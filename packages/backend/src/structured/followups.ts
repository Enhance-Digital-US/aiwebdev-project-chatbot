import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import type { ModelCall } from "../usage";

/**
 * Follow-up suggestions (every answer) and a conversation title (first answer only),
 * produced as one structured-output call after the answer finishes streaming.
 */
export function followupsSchema(withTitle: boolean) {
  // array().length(3) becomes minItems/maxItems, which OpenAI strict mode accepts;
  // a tuple would become prefixItems, which it doesn't. "Short" is left to the
  // prompt: a hard per-chip cap would drop a whole good set over one long chip.
  const suggestions = z.array(z.string().trim().min(1)).length(3);
  // Two shapes rather than an optional field: the model only sees `title` when
  // one is wanted, so it never spends tokens on titles that would be ignored.
  return withTitle
    ? z.object({ suggestions, title: z.string().trim().min(1).max(60) })
    : z.object({ suggestions });
}

export type Followups = { suggestions: string[]; title?: string };

/** Validates raw model output; anything off-schema becomes null (dropped, never shown). */
export function parseFollowups(raw: unknown, withTitle: boolean): Followups | null {
  const result = followupsSchema(withTitle).safeParse(raw);
  return result.success ? result.data : null;
}

/** First exchange = the request carries exactly one user message and nothing else. */
export function isFirstExchange(messages: { role: string }[]): boolean {
  return messages.length === 1 && messages[0].role === "user";
}

export async function generateFollowups({
  model,
  messages,
  withTitle,
  headers,
  onCall,
}: {
  model: LanguageModel;
  /** The conversation so far, including the answer that just finished. */
  messages: ModelMessage[];
  withTitle: boolean;
  headers?: Record<string, string>;
  /** Reports the call's usage, even when its output is then dropped. */
  onCall?: (call: ModelCall) => void;
}): Promise<Followups | null> {
  try {
    const { output } = await generateText({
      model,
      system: `Suggest exactly three short follow-up prompts the user might send next, written in the user's voice (for example "Show me an example"). Keep each under 80 characters and specific to the conversation.${
        withTitle
          ? " Also give the conversation a short descriptive title of at most 60 characters, without quotes."
          : ""
      }`,
      messages,
      output: Output.object({ schema: followupsSchema(withTitle), name: "followups" }),
      headers,
      onStepEnd: (step) => onCall?.({ usage: step.usage, headers: step.response.headers }),
    });
    return parseFollowups(output, withTitle);
  } catch (error) {
    // Malformed or refused output is dropped silently: the answer stands on its own.
    console.warn("Follow-up generation failed:", error);
    return null;
  }
}
