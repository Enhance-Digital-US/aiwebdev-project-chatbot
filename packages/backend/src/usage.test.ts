import { describe, expect, it } from "vitest";
import type { LanguageModelUsage } from "ai";
import { addUsage, callUsage, messageUsage, type Price } from "./usage";

const price: Price = { input: 0.15, cachedInput: 0.075, output: 0.6 };

function usage(input: number, output: number, { cached = 0, written = 0, reasoning = 0 } = {}): LanguageModelUsage {
  return {
    inputTokens: input,
    inputTokenDetails: { noCacheTokens: input - cached - written, cacheReadTokens: cached, cacheWriteTokens: written },
    outputTokens: output,
    outputTokenDetails: { textTokens: output - reasoning, reasoningTokens: reasoning },
    totalTokens: input + output,
  };
}

describe("messageUsage", () => {
  it("sums every step of a multi-step answer", () => {
    // two tool steps and the final response
    const total = messageUsage(
      [{ usage: usage(1000, 20) }, { usage: usage(1200, 30) }, { usage: usage(1500, 200) }],
      price
    );
    expect(total.inputTokens).toBe(3700);
    expect(total.outputTokens).toBe(250);
    expect(total.cost).toBeCloseTo((3700 * 0.15 + 250 * 0.6) / 1e6, 12);
  });

  it("prices cached input at the cached rate, without counting it twice", () => {
    const u = callUsage({ usage: usage(2000, 100, { cached: 1024 }) }, price);
    expect(u.cachedInputTokens).toBe(1024);
    expect(u.cost).toBeCloseTo((976 * 0.15 + 1024 * 0.075 + 100 * 0.6) / 1e6, 12);
  });

  it("prices cache writes at their own rate when the model has one, else as input", () => {
    const withRate = callUsage({ usage: usage(2000, 0, { written: 1500 }) }, { ...price, cacheWrite: 0.2 });
    expect(withRate.cost).toBeCloseTo((500 * 0.15 + 1500 * 0.2) / 1e6, 12);
    const withoutRate = callUsage({ usage: usage(2000, 0, { written: 1500 }) }, price);
    expect(withoutRate.cost).toBeCloseTo((2000 * 0.15) / 1e6, 12);
  });

  it("counts reasoning tokens as output, once", () => {
    const u = callUsage({ usage: usage(100, 500, { reasoning: 400 }) }, price);
    expect(u.reasoningTokens).toBe(400);
    expect(u.cost).toBeCloseTo((100 * 0.15 + 500 * 0.6) / 1e6, 12);
  });

  it("no price → tokens counted, cost unknown (not zero)", () => {
    const u = messageUsage([{ usage: usage(800, 50) }], undefined);
    expect(u.inputTokens).toBe(800);
    expect(u.cost).toBeNull();
  });

  it("an unknown cost makes the sum unknown", () => {
    expect(addUsage(callUsage({ usage: usage(1, 1) }, price), callUsage({ usage: usage(1, 1) }, undefined)).cost).toBeNull();
  });

  it("a gateway cache hit is all cached input and free", () => {
    const u = callUsage({ usage: usage(1594, 41), headers: { "cf-aig-cache-status": "HIT" } }, price);
    expect(u).toMatchObject({ inputTokens: 1594, cachedInputTokens: 1594, outputTokens: 41, cost: 0 });
    const miss = callUsage({ usage: usage(1594, 41), headers: { "cf-aig-cache-status": "MISS" } }, price);
    expect(miss.cost).toBeGreaterThan(0);
  });

  it("missing provider numbers count as zero", () => {
    const empty = {
      inputTokens: undefined,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokens: undefined,
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
    } satisfies LanguageModelUsage;
    expect(callUsage({ usage: empty }, price)).toMatchObject({ inputTokens: 0, outputTokens: 0, cost: 0 });
  });
});
