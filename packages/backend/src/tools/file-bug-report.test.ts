import { describe, expect, it, vi } from "vitest";

// The tool imports the workflow module, which imports workerd-only modules.
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

const { createFileBugReportTool, issueTrackerLoaded } = await import("./file-bug-report");

describe("fileBugReport", () => {
  // The card polls the run as soon as it sees the id, but the first step can
  // start seconds later. Without a row, that first poll was a 404 ("Bug report
  // not found") and the card stopped polling for good.
  it("writes the progress row before starting the run", async () => {
    const events: string[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            expect(sql).toMatch(/INSERT INTO bug_reports/);
            events.push(`row:${args[0]}:${args[1]}:${args[2]}`);
          },
        }),
      }),
    };
    const env = {
      DB: db,
      BUG_REPORT: {
        create: async ({ id }: { id: string }) => {
          events.push(`create:${id}`);
          return { id };
        },
      },
    } as never;

    const tool = createFileBugReportTool(env, { userId: "dev@example.com", chatId: "chat-1" });
    const out = (await tool.execute!({ log: "TypeError: boom" }, {
      toolCallId: "t1",
      messages: [],
      context: {},
    } as never)) as { instanceId: string };

    // Row first: written after create(), it could rewind a run that already advanced.
    expect(events).toEqual([`row:${out.instanceId}:dev@example.com:chat-1`, `create:${out.instanceId}`]);
  });
});

describe("issueTrackerLoaded", () => {
  it("is true when the tracker's tools loaded on this request", () => {
    expect(issueTrackerLoaded({ "issue-tracker_search_issues": {}, "cf-docs_search_docs": {} })).toBe(true);
  });

  // A tracker that's down (or a wrong ISSUE_TRACKER_URL) is skipped by the MCP
  // loader; offering fileBugReport then starts a run that can't finish.
  it("is false when only other servers' tools loaded", () => {
    expect(issueTrackerLoaded({ "cf-docs_search_docs": {} })).toBe(false);
  });
});
