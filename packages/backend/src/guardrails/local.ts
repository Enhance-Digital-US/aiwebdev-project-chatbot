import type { SafetyChecker, GuardMessage, SafetyResult } from "./checker";
import { parseLlamaGuardResponse } from "./checker";

export function createLocalChecker(
  baseUrl = "http://localhost:11434"
): SafetyChecker {
  return async (messages: GuardMessage[]): Promise<SafetyResult> => {
    if (messages.length === 0) return { safe: true, categories: [] };

    const ollamaMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-guard3:1b",
        messages: ollamaMessages,
        stream: false,
      }),
    });

    if (!res.ok) {
      console.error(`Ollama Llama Guard error: ${res.status}`);
      return { safe: true, categories: [] };
    }

    const data = (await res.json()) as {
      message: { role: string; content: string };
    };

    return parseLlamaGuardResponse(data.message.content);
  };
}
