import type { ApiProvider, ProviderResponse } from "promptfoo";

const CHATBOT_URL = process.env.CHATBOT_URL ?? "http://localhost:8788";

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
      const content = text
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
        })
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

      return { output: content };
    } catch (err) {
      return {
        error: `Failed to reach chatbot at ${CHATBOT_URL}: ${err}`,
      };
    }
  }
}
