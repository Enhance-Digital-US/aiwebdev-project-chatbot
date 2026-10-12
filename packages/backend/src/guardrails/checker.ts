import type { LanguageModelMiddleware } from "ai";

type TransformParamsArg = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0];
export type GuardPrompt = TransformParamsArg["params"]["prompt"];

export type GuardMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "user" | "tool";
};

export type SafetyResult = {
  safe: boolean;
  categories: string[];
};

export type SafetyChecker = (
  messages: GuardMessage[]
) => Promise<SafetyResult>;

const LLAMA_GUARD_CATEGORIES: Record<string, string> = {
  S1: "Violent Crimes",
  S2: "Non-Violent Crimes",
  S3: "Sex-Related Crimes",
  S4: "Child Sexual Exploitation",
  S5: "Defamation",
  S6: "Specialized Advice",
  S7: "Privacy",
  S8: "Intellectual Property",
  S9: "Indiscriminate Weapons",
  S10: "Hate",
  S11: "Suicide & Self-Harm",
  S12: "Sexual Content",
  S13: "Elections",
};

export function parseLlamaGuardResponse(text: string): SafetyResult {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "safe") {
    return { safe: true, categories: [] };
  }
  const lines = trimmed.split("\n");
  const categories = lines
    .slice(1)
    .map((l) => l.trim().toUpperCase())
    .filter((c) => c in LLAMA_GUARD_CATEGORIES);
  return { safe: false, categories };
}

export function categoryLabel(code: string): string {
  return LLAMA_GUARD_CATEGORIES[code] ?? code;
}

export function extractGuardMessages(
  prompt: GuardPrompt
): GuardMessage[] {
  const messages: GuardMessage[] = [];

  for (const msg of prompt) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      const text = msg.content
        .filter(
          (p: { type: string }): p is { type: "text"; text: string } =>
            p.type === "text"
        )
        .map((p: { text: string }) => p.text)
        .join("\n");
      if (text) messages.push({ role: "user", content: text });
    }

    if (msg.role === "assistant") {
      const text = msg.content
        .filter(
          (p: { type: string }): p is { type: "text"; text: string } =>
            p.type === "text"
        )
        .map((p: { text: string }) => p.text)
        .join("\n");
      if (text) messages.push({ role: "assistant", content: text });
    }

    if (msg.role === "tool") {
      const parts = msg.content as Array<{
        type: string;
        toolName?: string;
        output?: unknown;
      }>;
      const toolResults = parts.filter((p) => p.type === "tool-result");
      const allFromLoadSkill =
        toolResults.length > 0 &&
        toolResults.every((p) => p.toolName === "loadSkill");

      const text = toolResults
        .map((p) => {
          const out = p.output as
            | { type: string; value: unknown }
            | undefined;
          if (!out) return "";
          if (out.type === "text") return String(out.value);
          if (out.type === "json") return JSON.stringify(out.value);
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) {
        messages.push({
          role: "user",
          content: text,
          source: allFromLoadSkill ? "tool" : undefined,
        });
      }
    }
  }

  return messages;
}

export function extractNewMessages(
  prompt: GuardPrompt,
  previousCount: number
): GuardMessage[] {
  const all = extractGuardMessages(prompt);
  return all.slice(previousCount);
}
