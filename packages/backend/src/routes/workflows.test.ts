import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import type { BugReportProgress } from "../workflows/progress";

const progress = vi.hoisted(() => ({ current: null as BugReportProgress | null }));
vi.mock("../workflows/progress", () => ({ readProgress: async () => progress.current }));
const { default: workflowRoutes, canAccess } = await import("./workflows");

const waiting = (userId: string | null): BugReportProgress => ({
  instanceId: "wf-1",
  userId,
  chatId: "chat-1",
  step: "approval",
  draft: null,
  dupes: [],
  result: null,
});

function setup({ caller, environment }: { caller: string | null; environment: "development" | "production" }) {
  const sendEvent = vi.fn(async () => {});
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", caller);
    await next();
  });
  app.route("/api", workflowRoutes);
  const env = {
    ENVIRONMENT: environment,
    DB: {},
    BUG_REPORT: { get: async () => ({ sendEvent, status: async () => ({ status: "running" }) }) },
  };
  const decide = (body: unknown = { decision: "approve" }) =>
    app.request("/api/workflows/wf-1/decision", { method: "POST", body: JSON.stringify(body) }, env);
  return { decide, sendEvent };
}

describe("canAccess", () => {
  it("deployed: only the verified starter", () => {
    expect(canAccess(waiting("bob@example.com"), "bob@example.com", false)).toBe(true);
    expect(canAccess(waiting("bob@example.com"), "carol@example.com", false)).toBe(false);
    expect(canAccess(waiting("bob@example.com"), null, false)).toBe(false);
    // Started without an identity (verification failed): nobody may decide.
    expect(canAccess(waiting(null), "bob@example.com", false)).toBe(false);
  });

  it("local: a run started without an identity is open to any caller", () => {
    expect(canAccess(waiting(null), null, true)).toBe(true);
  });
});

describe("POST /api/workflows/:id/decision", () => {
  it("lets the starter approve, sending the decision to the workflow", async () => {
    progress.current = waiting("bob@example.com");
    const { decide, sendEvent } = setup({ caller: "bob@example.com", environment: "production" });
    const res = await decide({ decision: "approve", edits: { severity: "critical" } });
    expect(res.status).toBe(200);
    expect(sendEvent).toHaveBeenCalledWith({
      type: "bug-approval",
      payload: { decision: "approve", edits: { severity: "critical" } },
    });
  });

  it("refuses another deployed user", async () => {
    progress.current = waiting("bob@example.com");
    const { decide, sendEvent } = setup({ caller: "carol@example.com", environment: "production" });
    expect((await decide()).status).toBe(403);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("lets any local caller decide a run started locally", async () => {
    progress.current = waiting(null);
    const { decide } = setup({ caller: null, environment: "development" });
    expect((await decide({ decision: "reject" })).status).toBe(200);
  });

  it("refuses a run that isn't waiting for approval", async () => {
    progress.current = { ...waiting(null), step: "done", result: { outcome: "rejected" } };
    const { decide, sendEvent } = setup({ caller: null, environment: "development" });
    expect((await decide()).status).toBe(409);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed decisions and invalid edits", async () => {
    progress.current = waiting(null);
    const { decide } = setup({ caller: null, environment: "development" });
    expect((await decide({ decision: "maybe" })).status).toBe(400);
    expect((await decide({ decision: "approve", edits: { severity: "urgent" } })).status).toBe(400);
  });
});
