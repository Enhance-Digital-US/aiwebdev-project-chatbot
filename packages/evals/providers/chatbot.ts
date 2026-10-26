import type { ApiProvider, ProviderResponse } from "promptfoo";

const CHATBOT_URL = process.env.CHATBOT_URL ?? "http://localhost:8788";

/** A tool call seen in the stream, exposed to assertions as `context.metadata.toolCalls`. */
interface ToolCall {
  toolName: string;
  input: unknown;
  output?: unknown;
}

/**
 * A bug-report run started by `fileBugReport` drafts in the background. Wait
 * for the draft (so assertions can check it via `context.metadata.bugDraft`),
 * then reject the run so evals never leave approvals pending or file issues.
 */
async function collectBugDraft(instanceId: string): Promise<unknown> {
  let draft: unknown = null;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${CHATBOT_URL}/api/workflows/${instanceId}`);
    const status = (await res.json()) as { step?: string; draft?: unknown; result?: unknown };
    draft = status.draft ?? draft;
    if (status.step === "approval" || status.result) {
      await fetch(`${CHATBOT_URL}/api/workflows/${instanceId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "reject" }),
      });
      return status.draft ?? null;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Never reached approval (e.g. no issue tracker for dedupe): the draft, if any, still counts.
  return draft;
}

export default class ChatbotProvider implements ApiProvider {
  private modelId: string;

  constructor(
    options?: string | { id?: string; config?: Record<string, unknown>; env?: Record<string, string> },
  ) {
    this.modelId =
      typeof options === "string"
        ? options
        : (options?.config?.model as string) ?? "gpt-4o-mini";
  }

  id() {
    return `chatbot:${this.modelId}`;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    // The backend passes `messages` straight to `convertToModelMessages`,
    // which expects the AI SDK `UIMessage` shape (`Omit<UIMessage, "id">`):
    // `{ role, parts: [{ type: "text", text }] }` — there is no `content` field.
    const messages = [
      { role: "user" as const, parts: [{ type: "text" as const, text: prompt }] },
    ];

    try {
      const res = await fetch(`${CHATBOT_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, model: this.modelId }),
      });

      if (!res.ok) {
        return { error: `Chatbot API error: ${res.status} ${res.statusText}` };
      }

      // The backend responds via `createUIMessageStreamResponse`, which pipes
      // the UI message stream through `JsonToSseTransformStream`. That emits
      // Server-Sent Events: `data: <json>\n\n`, terminated by `data: [DONE]\n\n`.
      // Each JSON payload is a `UIMessageChunk`; text is delivered as
      // `{ type: "text-delta", id, delta }` chunks that must be concatenated.
      const text = await res.text();
      const chunks = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter((data) => data.length > 0 && data !== "[DONE]")
        .map((data) => {
          try {
            return JSON.parse(data);
          } catch {
            return null;
          }
        });

      const toolCalls = new Map<string, ToolCall>();
      for (const chunk of chunks) {
        if (chunk?.type === "tool-input-available") {
          toolCalls.set(chunk.toolCallId, { toolName: chunk.toolName, input: chunk.input });
        } else if (chunk?.type === "tool-output-available" && toolCalls.has(chunk.toolCallId)) {
          toolCalls.get(chunk.toolCallId)!.output = chunk.output;
        }
      }
      const bugReport = [...toolCalls.values()].find((t) => t.toolName === "fileBugReport");
      const instanceId = (bugReport?.output as { instanceId?: string } | undefined)?.instanceId;

      const content = chunks
        .filter(
          (chunk): chunk is Record<string, unknown> =>
            chunk?.type === "text-delta" || chunk?.type === "error",
        )
        .map((chunk) => {
          if (chunk.type === "error") {
            const err = chunk.error;
            const msg =
              typeof err === "string"
                ? err
                : (err as { message?: string })?.message ?? "unknown";
            return `[Error: ${msg}]`;
          }
          return (chunk.delta as string) ?? "";
        })
        .join("");

      return {
        output: content,
        metadata: {
          toolCalls: [...toolCalls.values()],
          ...(instanceId && { bugDraft: await collectBugDraft(instanceId) }),
        },
      };
    } catch (err) {
      return {
        error: `Failed to reach chatbot at ${CHATBOT_URL}: ${err}`,
      };
    }
  }
}
