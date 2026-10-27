import type { SafetyChecker, GuardMessage, SafetyResult } from "./checker";
import { parseLlamaGuardResponse } from "./checker";

export function createCloudChecker(ai: Ai): SafetyChecker {
  return async (messages: GuardMessage[]): Promise<SafetyResult> => {
    if (messages.length === 0) return { safe: true, categories: [] };

    const cfMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = (await ai.run("@cf/meta/llama-guard-3-8b" as Parameters<Ai["run"]>[0], {
      messages: cfMessages,
    })) as { response: string };

    return parseLlamaGuardResponse(response.response);
  };
}
