import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { readProgress, type BugReportProgress } from "../workflows/progress";
import { BugDraftEditsSchema } from "../workflows/bug-draft";

const workflows = new Hono<AppEnv>();

/**
 * Only the user who started a run may see or decide it. Deployed, that needs a
 * verified identity matching the starter's. Locally nobody has an identity,
 * so a run started without one is open to any caller.
 */
export function canAccess(progress: BugReportProgress, callerId: string | null, local: boolean): boolean {
  if (progress.userId === null) return local;
  return callerId !== null && callerId === progress.userId;
}

workflows.get("/workflows/:id", async (c) => {
  const id = c.req.param("id");
  const progress = await readProgress(c.env.DB, id);
  if (!progress) return c.json({ error: "Not found" }, 404);
  if (!canAccess(progress, c.get("userId"), c.env.ENVIRONMENT === "development")) {
    return c.json({ error: "Not found" }, 404); // don't reveal other users' runs
  }
  const status = await (await c.env.BUG_REPORT.get(id)).status();
  return c.json({
    id,
    status: status.status,
    step: progress.step,
    draft: progress.draft,
    dupes: progress.dupes,
    result: progress.result,
    error: status.status === "errored" ? "The bug report failed unexpectedly." : undefined,
  });
});

const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: BugDraftEditsSchema.optional(),
});

workflows.post("/workflows/:id/decision", async (c) => {
  const id = c.req.param("id");
  const parsed = DecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid decision" }, 400);

  const progress = await readProgress(c.env.DB, id);
  if (!progress) return c.json({ error: "Not found" }, 404);
  if (!canAccess(progress, c.get("userId"), c.env.ENVIRONMENT === "development")) {
    return c.json({ error: "Only the person who started this bug report can decide it" }, 403);
  }
  // sendEvent doesn't fail on a finished run (seen in wrangler dev), so check first.
  if (progress.step !== "approval" || progress.result) {
    return c.json({ error: "This bug report isn't waiting for approval" }, 409);
  }

  await (await c.env.BUG_REPORT.get(id)).sendEvent({ type: "bug-approval", payload: parsed.data });
  return c.json({ ok: true });
});

export default workflows;
