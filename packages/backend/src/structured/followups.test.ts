import { describe, expect, it, vi } from "vitest";
import { generateFollowups, isFirstExchange, parseFollowups } from "./followups";
import type { LanguageModel } from "ai";

const three = ["Show me an example", "How does caching work?", "What about errors?"];

describe("parseFollowups", () => {
  it("accepts three suggestions", () => {
    expect(parseFollowups({ suggestions: three }, false)).toEqual({ suggestions: three });
  });

  it("accepts a title on the first exchange", () => {
    expect(parseFollowups({ suggestions: three, title: "Workers caching" }, true)).toEqual({
      suggestions: three,
      title: "Workers caching",
    });
  });

  it("rejects the wrong number of suggestions", () => {
    expect(parseFollowups({ suggestions: three.slice(0, 2) }, false)).toBeNull();
    expect(parseFollowups({ suggestions: [...three, "One more"] }, false)).toBeNull();
  });

  it("rejects empty suggestions and non-strings", () => {
    expect(parseFollowups({ suggestions: ["", "a", "b"] }, false)).toBeNull();
    expect(parseFollowups({ suggestions: [1, 2, 3] }, false)).toBeNull();
    expect(parseFollowups("not an object", false)).toBeNull();
  });

  it("rejects a title over 60 characters or a missing title when one is needed", () => {
    expect(parseFollowups({ suggestions: three, title: "x".repeat(61) }, true)).toBeNull();
    expect(parseFollowups({ suggestions: three }, true)).toBeNull();
  });
});

describe("isFirstExchange", () => {
  it("is true only for a lone user message", () => {
    expect(isFirstExchange([{ role: "user" }])).toBe(true);
    expect(isFirstExchange([{ role: "user" }, { role: "assistant" }, { role: "user" }])).toBe(false);
  });
});

describe("generateFollowups", () => {
  /** A minimal language model that returns the given text as its answer. */
  function modelReturning(text: string): LanguageModel {
    return {
      specificationVersion: "v4",
      provider: "test",
      modelId: "test",
      supportedUrls: {},
      doGenerate: async () => ({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
      doStream: async () => {
        throw new Error("not used");
      },
    } as unknown as LanguageModel;
  }

  const messages = [{ role: "user" as const, content: "hi" }];

  it("returns parsed suggestions from valid JSON", async () => {
    const result = await generateFollowups({
      model: modelReturning(JSON.stringify({ suggestions: three })),
      messages,
      withTitle: false,
    });
    expect(result).toEqual({ suggestions: three });
  });

  it("drops malformed output silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const text of ["not json", JSON.stringify({ suggestions: ["only one"] })]) {
      await expect(
        generateFollowups({ model: modelReturning(text), messages, withTitle: false })
      ).resolves.toBeNull();
    }
    warn.mockRestore();
  });
});
