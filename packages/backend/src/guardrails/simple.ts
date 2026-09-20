import type { SafetyChecker, GuardMessage, SafetyResult } from "./checker";

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /reveal\s+(your|the)\s+system\s+prompt/i,
  /what\s+(is|are)\s+your\s+(instructions|rules|system\s+prompt)/i,
  /\bDAN\b.*\bjailbreak/i,
  /do\s+anything\s+now/i,
  /bypass\s+(your|all|any)\s+(restrictions|filters|safety)/i,
];

const BLOCKLIST_TERMS = [
  /\b(kill|murder|assassinate)\s+(him|her|them|yourself)\b/i,
  /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon)/i,
];

function regexCheck(text: string): SafetyResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, categories: ["INJECTION"] };
    }
  }
  for (const pattern of BLOCKLIST_TERMS) {
    if (pattern.test(text)) {
      return { safe: false, categories: ["BLOCKLIST"] };
    }
  }
  return { safe: true, categories: [] };
}

export function createSimpleChecker(openaiApiKey: string): SafetyChecker {
  return async (messages: GuardMessage[]): Promise<SafetyResult> => {
    const text = messages.map((m) => m.content).join("\n");

    const regex = regexCheck(text);
    if (!regex.safe) return regex;

    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!res.ok) {
      console.error(`OpenAI Moderation API error: ${res.status}`);
      return { safe: true, categories: [] };
    }

    const data = (await res.json()) as {
      results: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
      }>;
    };
    const result = data.results[0];

    if (result.flagged) {
      const flagged = Object.entries(result.categories)
        .filter(([, v]) => v)
        .map(([k]) => k.toUpperCase().replace(/[/-]/g, "_"));
      return { safe: false, categories: flagged };
    }

    return { safe: true, categories: [] };
  };
}

export { regexCheck };
