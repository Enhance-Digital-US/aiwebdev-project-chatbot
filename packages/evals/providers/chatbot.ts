import type { ApiProvider, ProviderResponse } from "promptfoo";

const CHATBOT_URL = process.env.CHATBOT_URL ?? "http://localhost:8787";

export default class ChatbotProvider implements ApiProvider {
  private modelId: string;

  constructor(modelId?: string) {
    this.modelId = modelId ?? "gpt-4o-mini";
  }

  id() {
    return `chatbot:${this.modelId}`;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const messages = [{ role: "user" as const, content: prompt }];

    try {
      const res = await fetch(`${CHATBOT_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, model: this.modelId }),
      });

      if (!res.ok) {
        return { error: `Chatbot API error: ${res.status} ${res.statusText}` };
      }

      const text = await res.text();
      const lines = text.split("\n").filter((l) => l.startsWith("0:"));
      const content = lines
        .map((l) => {
          try {
            return JSON.parse(l.slice(2));
          } catch {
            return "";
          }
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
