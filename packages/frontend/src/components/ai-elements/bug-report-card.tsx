import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { BugIcon, CheckCircleIcon, CircleIcon, XCircleIcon } from "lucide-react";

/** Mirrors GET /api/workflows/:id (backend routes/workflows.ts). */
type Severity = "critical" | "high" | "medium" | "low";
type Draft = { title: string; summary: string; stepsToReproduce: string[]; severity: Severity; component: string };
type Result =
  | { outcome: "filed"; issue: { id: string; title: string; replayed: boolean } }
  | { outcome: "rejected" }
  | { outcome: "expired" }
  | { outcome: "not-permitted"; message: string };
type Status = {
  id: string;
  status: string;
  step: "redact" | "draft" | "dedupe" | "approval" | "file" | "done";
  draft: Draft | null;
  dupes: { id: string; title: string; status: string }[] | null;
  result: Result | null;
  error?: string;
};

const STEPS = [
  { key: "redact", label: "Redact secrets" },
  { key: "draft", label: "Draft report" },
  { key: "dedupe", label: "Check duplicates" },
  { key: "approval", label: "Your approval" },
  { key: "file", label: "File issue" },
] as const;

const POLL_MS = 2000;

// Pending runs survive a refresh here until chats are persisted (lesson 19).
const STORAGE_KEY = "team-assistant:bug-reports";

export function rememberBugReport(id: string) {
  try {
    const ids = new Set<string>(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
    ids.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // storage unavailable: the card just won't come back after a refresh
  }
}

function forgetBugReport(id: string) {
  try {
    const ids = (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]).filter((x) => x !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function rememberedBugReports(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function useBugReport(id: string) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/workflows/${id}`);
        if (!res.ok) throw new Error(res.status === 404 ? "Bug report not found" : `HTTP ${res.status}`);
        const next = (await res.json()) as Status;
        if (stopped) return;
        setStatus(next);
        setError(null);
        if (next.result || next.status === "errored") {
          forgetBugReport(id);
          return;
        }
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        if ((e as Error).message === "Bug report not found") {
          forgetBugReport(id);
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  return { status, error, setStatus };
}

function StepList({ status }: { status: Status }) {
  const current = STEPS.findIndex((s) => s.key === status.step);
  const finished = status.step === "done";
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {STEPS.map((s, i) => {
        // A run that ended before filing (rejected/expired) never reached "file".
        const skipped = finished && s.key === "file" && status.result?.outcome !== "filed" && status.result?.outcome !== "not-permitted";
        const failed = finished && s.key === "file" && status.result?.outcome === "not-permitted";
        const done = !skipped && !failed && (finished || i < current);
        const active = !finished && i === current;
        return (
          <li key={s.key} className={cn("flex items-center gap-1", (skipped || (!done && !active)) && "text-muted-foreground")}>
            {failed ? (
              <XCircleIcon className="size-3.5 text-destructive" />
            ) : done ? (
              <CheckCircleIcon className="size-3.5 text-green-600" />
            ) : active ? (
              <Spinner className="size-3.5" />
            ) : (
              <CircleIcon className="size-3.5" />
            )}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function Outcome({ result }: { result: Result }) {
  switch (result.outcome) {
    case "filed":
      return (
        <p className="text-sm">
          Filed <span className="font-mono text-xs">{result.issue.id.slice(0, 8)}</span>: {result.issue.title}
        </p>
      );
    case "rejected":
      return <p className="text-sm text-muted-foreground">Rejected — nothing was filed.</p>;
    case "expired":
      return <p className="text-sm text-muted-foreground">No decision within the approval window — nothing was filed.</p>;
    case "not-permitted":
      return <p className="text-sm text-destructive">{result.message}</p>;
  }
}

export function BugReportCard({ instanceId }: { instanceId: string }) {
  const { status, error, setStatus } = useBugReport(instanceId);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<{ title: string; severity: Severity } | null>(null);
  const [sending, setSending] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    setSending(true);
    setDecisionError(null);
    try {
      const res = await fetch(`/api/workflows/${instanceId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(decision === "approve" && edits && { edits }) }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      // Optimistic: the workflow moves on; polling confirms.
      setStatus((s) => (s ? { ...s, step: decision === "approve" ? "file" : "done" } : s));
      setEditing(false);
    } catch (e) {
      setDecisionError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const draft = status?.draft;
  const waiting = status?.step === "approval" && !status.result;

  return (
    <Card className="my-2 max-w-xl shrink-0 gap-3 py-4" aria-label="Bug report">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BugIcon className="size-4" />
          Bug report
          {draft && <Badge variant="outline">{edits?.severity ?? draft.severity}</Badge>}
        </CardTitle>
        <CardDescription className="text-xs">
          {status ? <StepList status={status} /> : error ? error : "Starting…"}
        </CardDescription>
      </CardHeader>

      {draft && (
        <CardContent className="space-y-2 px-4 text-sm">
          {editing ? (
            <div className="space-y-2">
              <Input
                aria-label="Title"
                value={edits?.title ?? draft.title}
                onChange={(e) => setEdits({ title: e.target.value, severity: edits?.severity ?? draft.severity })}
              />
              <select
                aria-label="Severity"
                className="rounded-md border bg-background px-2 py-1 text-sm"
                value={edits?.severity ?? draft.severity}
                onChange={(e) =>
                  setEdits({ title: edits?.title ?? draft.title, severity: e.target.value as Severity })
                }
              >
                {(["critical", "high", "medium", "low"] as const).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="font-medium">{edits?.title ?? draft.title}</p>
          )}
          <p className="text-muted-foreground">{draft.summary}</p>
          <ol className="list-decimal pl-5 text-muted-foreground">
            {draft.stepsToReproduce.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">Component: {draft.component}</p>
          {status?.dupes && status.dupes.length > 0 && (
            <div className="rounded-md border border-amber-500/40 p-2 text-xs">
              <p className="font-medium">Possible duplicates</p>
              <ul>
                {status.dupes.map((d) => (
                  <li key={d.id}>
                    {d.title} <span className="text-muted-foreground">({d.status})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}

      <CardFooter className="flex-col items-start gap-2 px-4">
        {status?.result && <Outcome result={status.result} />}
        {status?.status === "errored" && <p className="text-sm text-destructive">{status.error}</p>}
        {waiting && (
          <div className="flex gap-2">
            <Button size="sm" disabled={sending} onClick={() => decide("approve")}>
              {edits ? "Approve with edits" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" disabled={sending} onClick={() => setEditing((e) => !e)}>
              {editing ? "Done editing" : "Edit"}
            </Button>
            <Button size="sm" variant="ghost" disabled={sending} onClick={() => decide("reject")}>
              Reject
            </Button>
          </div>
        )}
        {decisionError && <p className="text-xs text-destructive">{decisionError}</p>}
      </CardFooter>
    </Card>
  );
}
