import Langfuse from "langfuse";

/**
 * Why this doesn't just call `langfuse.fetchTraces()` / `langfuse.fetchTrace()`
 * as the SDK docs (and older examples) suggest:
 *
 * The `langfuse` npm package (v3) is Langfuse's deprecated v3 client — its own
 * package.json says so. It hard-codes reads against the legacy REST surface
 * (`GET /api/public/traces`, `GET /api/public/traces/{id}`, `GET /api/public/v2/scores`,
 * ...). Langfuse now returns `410 LEGACY_API_UNAVAILABLE_FOR_NEW_ORGANIZATION` for
 * those endpoints on any org created on or after 2026-09-16 (verified against this
 * project's Langfuse org). Per Langfuse's own deprecation notice, "the only path to
 * live data is OpenTelemetry ingestion combined with `GET /api/public/v2/observations`
 * and `GET /api/public/v2/metrics`" — so trace reads here go straight to
 * `/api/public/v2/observations` with the same Basic-auth fetch pattern already used
 * in `packages/backend/src/telemetry.ts`, instead of the SDK's read helpers.
 *
 * Score *writes* are unaffected: `langfuse.score()` + `flushAsync()` post to the
 * ingestion API, not the legacy trace API, and were confirmed working (a written
 * score round-tripped through `GET /api/public/v3/scores`).
 *
 * `/api/public/v2/observations` returns a flat list of spans (not grouped into
 * traces), ordered newest-first, with cursor pagination. We page through it,
 * group spans by `traceId`, and treat the first N distinct trace IDs encountered
 * as the N most recently active traces.
 */

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;
const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com";

if (!publicKey || !secretKey) {
  console.error(
    "Langfuse eval scoring failed: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.",
  );
  process.exit(1);
}

const langfuse = new Langfuse({ publicKey, secretKey, baseUrl });

const TRACE_LIMIT = 50;
const OBSERVATIONS_PAGE_SIZE = 100;
const MAX_PAGES = 20;

interface ObservationSummary {
  id: string;
  traceId: string;
  type: string;
  name: string | null;
  level: string;
  statusMessage: string | null;
  startTime: string;
}

interface ObservationsPage {
  data: ObservationSummary[];
  meta: { cursor?: string };
}

async function fetchRecentObservations(): Promise<ObservationSummary[]> {
  const authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;
  const observations: ObservationSummary[] = [];
  const traceIds = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES && traceIds.size < TRACE_LIMIT; page++) {
    const url = new URL(`${baseUrl}/api/public/v2/observations`);
    url.searchParams.set("limit", String(OBSERVATIONS_PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      throw new Error(
        `Langfuse observations fetch failed: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as ObservationsPage;
    if (!json.data?.length) break;

    for (const obs of json.data) {
      observations.push(obs);
      traceIds.add(obs.traceId);
    }

    if (!json.meta?.cursor) break;
    cursor = json.meta.cursor;
  }

  return observations;
}

function groupByTrace(
  observations: ObservationSummary[],
): Map<string, ObservationSummary[]> {
  const byTrace = new Map<string, ObservationSummary[]>();
  for (const obs of observations) {
    const list = byTrace.get(obs.traceId);
    if (list) list.push(obs);
    else byTrace.set(obs.traceId, [obs]);
  }
  return byTrace;
}

function isToolObservation(obs: ObservationSummary): boolean {
  return obs.type === "TOOL" || (obs.name?.toLowerCase().includes("tool") ?? false);
}

async function scoreTraces() {
  const observations = await fetchRecentObservations();
  const byTrace = groupByTrace(observations);

  // Spans arrive newest-first, so the first N distinct trace IDs encountered
  // are the N most recently active traces.
  const traceIds = [...byTrace.keys()].slice(0, TRACE_LIMIT);

  let scored = 0;

  for (const traceId of traceIds) {
    const traceObservations = byTrace.get(traceId) ?? [];

    const hasGuardrailBlock = traceObservations.some(
      (obs) =>
        obs.statusMessage?.includes("blocked by guardrails") ||
        obs.statusMessage?.includes("Content filtered"),
    );

    if (hasGuardrailBlock) {
      langfuse.score({
        traceId,
        name: "safety-guardrail-triggered",
        value: 1,
        comment: "Guardrail blocked or filtered content in this trace",
      });
      scored++;
    }

    const hasToolSpans = traceObservations.some(isToolObservation);

    if (hasToolSpans) {
      const toolErrors = traceObservations.filter(
        (obs) => isToolObservation(obs) && obs.level === "ERROR",
      );
      const toolUseScore = toolErrors.length > 0 ? 0 : 1;

      langfuse.score({
        traceId,
        name: "tool-use-success",
        value: toolUseScore,
        comment:
          toolUseScore === 1
            ? "All tool calls succeeded"
            : `${toolErrors.length} tool call(s) errored`,
      });
      scored++;
    }
  }

  await langfuse.flushAsync();
  console.log(`Scored ${scored} items across ${traceIds.length} traces`);
}

scoreTraces().catch((err) => {
  console.error("Langfuse eval scoring failed:", err);
  process.exit(1);
});
