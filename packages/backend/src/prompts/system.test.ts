import { describe, expect, it, vi } from "vitest";

// Skills are raw .md imports (a Wrangler module rule), which vitest can't parse.
vi.mock("../skills", () => ({ buildSkillsPrompt: () => "" }));

const { buildSystemPrompt } = await import("./system");

describe("buildSystemPrompt", () => {
  it("tells the model the tracker is unreachable, so it doesn't promise a report", () => {
    const prompt = buildSystemPrompt({ issueTrackerUnreachable: true });
    expect(prompt).toMatch(/can't be reached/);
    expect(prompt).not.toMatch(/Connect issue tracker/);
  });

  it("offers the connect link, not the outage notice, to a user who isn't connected", () => {
    const prompt = buildSystemPrompt({ issueTrackerConnectUrl: "/oauth/connect", issueTrackerUnreachable: true });
    expect(prompt).toMatch(/Connect issue tracker/);
    expect(prompt).not.toMatch(/can't be reached/);
  });

  it("says nothing about the tracker when it's available", () => {
    expect(buildSystemPrompt()).not.toMatch(/can't be reached|Connect issue tracker/);
  });
});
