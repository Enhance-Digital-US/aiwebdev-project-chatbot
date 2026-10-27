import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { BugDraftEditsSchema, BugDraftSchema, draftBugReport, issueDescription, type BugDraft } from "./bug-draft";

const valid: BugDraft = {
  title: "Chat stream fails when MCP server times out",
  summary: "POST /api/chat returns an error when deepwiki takes longer than 5 s to connect.",
  stepsToReproduce: ["Block mcp.deepwiki.com", "Send any chat message"],
  severity: "high",
  component: "mcp",
};

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function modelReturning(text: string) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    },
  });
  return { model, prompts };
}

describe("BugDraftSchema", () => {
  it("accepts a complete draft", () => {
    expect(BugDraftSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ["missing field", { ...valid, component: undefined }],
    ["unknown severity", { ...valid, severity: "urgent" }],
    ["no steps", { ...valid, stepsToReproduce: [] }],
    ["title too long", { ...valid, title: "x".repeat(121) }],
  ])("rejects %s", (_, draft) => {
    expect(BugDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("accepts partial edits but still validates them", () => {
    expect(BugDraftEditsSchema.parse({ severity: "critical" })).toEqual({ severity: "critical" });
    expect(BugDraftEditsSchema.safeParse({ severity: "urgent" }).success).toBe(false);
  });
});

describe("draftBugReport", () => {
  it("returns a schema-valid draft and sends only the redacted log", async () => {
    const { model, prompts } = modelReturning(JSON.stringify(valid));
    const draft = await draftBugReport({ model, redactedLog: "Bearer [REDACTED_TOKEN] failed" });
    expect(draft).toEqual(valid);
    expect(JSON.stringify(prompts)).toContain("[REDACTED_TOKEN]");
  });

  it("throws on off-schema output so the workflow step retries", async () => {
    const { model } = modelReturning(JSON.stringify({ ...valid, severity: "urgent" }));
    await expect(draftBugReport({ model, redactedLog: "boom" })).rejects.toThrow();
  });
});

describe("issueDescription", () => {
  it("numbers the steps and carries severity and component", () => {
    const text = issueDescription(valid);
    expect(text).toContain("1. Block mcp.deepwiki.com\n2. Send any chat message");
    expect(text).toContain("Severity: high · Component: mcp");
  });
});
