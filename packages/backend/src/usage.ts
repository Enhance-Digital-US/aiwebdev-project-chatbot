import type { LanguageModelUsage } from "ai";

/**
 * USD per 1M tokens (design §10). A model without one has an unknown cost.
 * `cacheWrite` is for providers that bill writing to the prompt cache
 * separately; without it, those tokens cost the normal input rate.
 */
export type Price = { input: number; cachedInput: number; cacheWrite?: number; output: number };

/** What one model call reports: its usage, and the response headers (for gateway cache hits). */
export type ModelCall = { usage: LanguageModelUsage; headers?: Record<string, string> };

/** Token usage and estimated cost of one assistant message, sent as its metadata. */
export type MessageUsage = {
  inputTokens: number;
  /** Input served from a cache: the provider's prompt cache, or an AI Gateway hit. Part of inputTokens. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Part of outputTokens. */
  reasoningTokens: number;
  /** USD; null when the model has no price, so it never shows as free. */
  cost: number | null;
};

export const EMPTY_USAGE: MessageUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cost: 0,
};

/**
 * Usage of one call. An AI Gateway cache hit replays the original response,
 * usage included, so the provider's numbers can't tell it was cached; the
 * `cf-aig-cache-status` header can. A hit is free: all of its input counts as
 * cached and it costs nothing.
 */
export function callUsage({ usage, headers }: ModelCall, price: Price | undefined): MessageUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
  if (headers?.["cf-aig-cache-status"] === "HIT") {
    return { inputTokens, cachedInputTokens: inputTokens, outputTokens, reasoningTokens, cost: 0 };
  }
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  // Cache reads and writes are part of the input and reasoning tokens part of
  // the output, so each token is priced exactly once.
  const cost = price
    ? ((inputTokens - cachedInputTokens - cacheWriteTokens) * price.input +
        cachedInputTokens * price.cachedInput +
        cacheWriteTokens * (price.cacheWrite ?? price.input) +
        outputTokens * price.output) /
      1_000_000
    : null;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, cost };
}

/** Sums usages; an unknown cost anywhere makes the total unknown. */
export function addUsage(...usages: MessageUsage[]): MessageUsage {
  return usages.reduce((sum, u) => ({
    inputTokens: sum.inputTokens + u.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + u.cachedInputTokens,
    outputTokens: sum.outputTokens + u.outputTokens,
    reasoningTokens: sum.reasoningTokens + u.reasoningTokens,
    cost: sum.cost === null || u.cost === null ? null : sum.cost + u.cost,
  }), EMPTY_USAGE);
}

/** Usage of every call behind one message (each agent step, plus follow-ups). */
export function messageUsage(calls: ModelCall[], price: Price | undefined): MessageUsage {
  return addUsage(...calls.map((call) => callUsage(call, price)));
}

/** Tokens that count against CHAT_TOKEN_CAP. */
export const tokenCount = (u: MessageUsage) => u.inputTokens + u.outputTokens;
