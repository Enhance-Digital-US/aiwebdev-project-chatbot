/**
 * Deterministic secret masking for pasted logs: the bug-report workflow's
 * first step, run before any model sees the log. Over-masking is cheap (a
 * report with "[IP]" in it is still useful); under-masking leaks a secret into
 * a model prompt and a filed issue, so the patterns lean broad.
 */
const RULES: { name: string; pattern: RegExp; replace: string }[] = [
  // "Authorization: Bearer <token>" and bare "Bearer <token>"
  { name: "bearer", pattern: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, replace: "$1[REDACTED_TOKEN]" },
  // JWTs anywhere (three base64url segments, header starts with {" → eyJ)
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, replace: "[REDACTED_TOKEN]" },
  // Provider-shaped keys: OpenAI/Anthropic/Langfuse (sk-/pk-…), GitHub, Slack, AWS, Stripe, Google
  {
    name: "api-key",
    pattern:
      /\b(?:sk|pk|rk)-(?:[a-z]+-)*[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: "[REDACTED_KEY]",
  },
  // key=value / key: value for secret-sounding names (keeps the name for context)
  {
    name: "secret-assignment",
    pattern: /\b((?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    replace: "$1[REDACTED]",
  },
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: "[REDACTED_EMAIL]" },
  // IPv4 (each octet 0-255)
  {
    name: "ipv4",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    replace: "[REDACTED_IP]",
  },
  // IPv6: at least four groups, or a "::" compression (so 12:30:45 times survive)
  {
    name: "ipv6",
    pattern: /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|(?:\b[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?\b/gi,
    replace: "[REDACTED_IP]",
  },
];

export function redactLog(log: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let text = log;
  for (const { name, pattern, replace } of RULES) {
    text = text.replace(pattern, (...match) => {
      counts[name] = (counts[name] ?? 0) + 1;
      // Re-run the single match through the rule to honor $1 back-references.
      return match[0].replace(new RegExp(pattern.source, pattern.flags.replace("g", "")), replace);
    });
  }
  return { text, counts };
}
