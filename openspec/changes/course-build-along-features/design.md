# Design

## Context

See proposal.md for motivation. Constraints:

- **Course lessons.** Each feature below is taught in one ai-web.dev module 02 lesson, and `course-checkpoint-history` later replays them one lesson at a time. Each feature therefore has to land as a self-contained slice that a reader can follow in a single lesson.
- **The issue-tracker server** (mcp-server `add-simulated-roles-oauth`):
  - It runs on `localhost:8787` and refuses any other Host.
  - Its dev-token endpoint (`POST /auth/dev-token {sub, scope}`) works in development only.
  - Access tokens expire after 1 hour. Refresh tokens are issued and last up to 7 days.
  - It accepts CIMD and dynamic client registration (DCR).
  - `create_issue` requires the `admin` or `member` role.
- **Cloudflare Access** guards the whole deployed hostname, which would also block the issue tracker from fetching a CIMD document.
- **The raw MCP client** speaks `2026-07-28` with a legacy fallback, and currently throws on `input_required`.

## Goals / Non-Goals

**Goals:** every capability in the proposal, each in its lesson's slice, with the app staying runnable after every slice.

**Non-Goals:**
- Images in bug reports (text only, by course decision).
- Sharing conversations between users.
- Per-user OAuth before lesson 19: lessons 13–18 run locally on dev tokens, by course decision ("hybrid").
- Supporting MRTR input kinds other than elicitation (sampling, roots).

## Decisions

### 1. Lesson slices

| Lesson (ai-web.dev, new numbering) | Slice |
|---|---|
| 07 Model Selection | AI Gateway routing for hosted providers |
| 09 Prompt Engineering | `prompts/system.ts`, the Team Assistant persona |
| 10 Structured Data | suggestions and titles (title shown in the header, in memory) |
| 13 MCP | `issue-tracker` server entry, dev-token credentials, MRTR elicitation and confirmation card |
| 16 Durable Workflows | bug-report workflow, its D1 progress record (the D1 binding arrives here), status and decision routes, workflow card |
| 17 Guardrails | (existing guardrails) plus a redaction check in the safety suite's fixtures |
| 18 Evals | new eval cases |
| 19 Infra & Security | D1 chat persistence (new tables in the existing database) and sidebar, per-user OAuth to the issue tracker, the Access bypass for client metadata, the token store |
| 20 Cost and Budget | usage metadata, price table, cost meter, per-chat cap (in D1), gateway caching |

Port 8788 and `.dev.vars.example` belong to the scaffold (lesson 03), so they're present from the first checkpoint.

### 2. Port 8788 for the backend

The backend moves to 8788, and the Vite proxy and the evals provider follow. *Alternative:* move the issue-tracker server instead. Rejected: its README walkthrough, the OAuth metadata and the Host check all assume 8787, and it isn't being rebuilt.

### 3. AI Gateway

OpenAI is created with the gateway's OpenAI-compatible base URL (account id + gateway name from vars, gateway token as a secret). The model registry's shape is unchanged; only `createModel` changes. Ollama stays direct.

### 4. Suggestions and titles in the same response

The chat route uses `createUIMessageStream`:
1. It merges the `streamText` stream.
2. Once that finishes, it runs one small structured-output call (Zod: `{ suggestions: string[3], title?: string }`, with `title` only requested on the first exchange).
3. It writes the result as a typed data part.

A failed parse writes nothing. *Alternative:* a second request from the browser. Rejected: it needs another round trip and another route for the same context.

### 5. Issue-tracker credentials: a credential source per server

Server entries gain an optional `credential` function that the loader calls per request, `(env, user) => Promise<headers>`.
- **Development:** mint from `/auth/dev-token` for `ISSUE_TRACKER_PERSONA` (default `user-bob` / `member`), cached in memory until 60 s before expiry.
- **Deployed (lesson 19):** read the user's record from D1, refresh it if it's expired, and return the bearer token. If there's no record, the server is skipped and the assistant is told how to connect.

### 6. MRTR elicitation

When the raw client sees `resultType: "input_required"` with `elicitation/create` requests, it returns them as a tool result of kind `input-required`, with the server's `requestState`. It doesn't throw.

The UI renders this as a confirmation card. The user's answer goes back as the next tool call's `inputResponses` through an AI SDK tool approval. Any other input kind still throws, as today.

The `ai-sdk` loader stays unchanged. Its limitation is documented as a lesson-13 contrast between the two loaders.

**Spike outcome (task 5.1): tool approval works as the carrier, with the probe inside `needsApproval`.**

What the spike established:
- **Wire format** (curl against the local tracker, as `user-alice`/`admin`): the first `tools/call` returns `{ resultType: "input_required", inputRequests: { confirm: { method: "elicitation/create", params: { message, requestedSchema } } }, requestState }`. The retry repeats the same `name`/`arguments` and adds `inputResponses: { confirm: { action: "accept", content: { proceed: true } } }` and the echoed `requestState`. `action: "decline"` returns "Project deletion cancelled." A `member` gets `Forbidden: requires one of [admin]` before any elicitation, so the delete demo needs `ISSUE_TRACKER_PERSONA=user-alice`.
- **AI SDK v7 tool approval** (mock-model test, two requests):
  - Request 1: `needsApproval(input, { toolCallId, messages })` runs (it may be async). `execute` doesn't. The step ends with a `tool-approval-request`.
  - Request 2, approved: `needsApproval` runs **again**, then `execute` runs once.
  - Request 2, denied: neither runs. The model gets `{ type: "execution-denied", reason }`.
- **What it can carry:** `ToolApprovalResponse` holds only `approved` + `reason`. It can answer a yes/no confirmation, but not a form.

Why the probe has to live in `needsApproval`: approval is decided before `execute`, but a server only reveals that it needs input during the call. The design's "return `input-required` as a tool result" step therefore happens inside `needsApproval`. The raw client's `callTool` returns `{ kind: "input-required", … }` instead of throwing, and the tool wrapper reacts:
1. **`needsApproval`.** If `messages` already has an approval response for this `toolCallId` (request 2), return `true` without probing. Otherwise call the tool:
   - `complete` → cache the result by `toolCallId` and return `false`. `execute` returns the cached result, so the call isn't made twice.
   - `input-required` for a supported elicitation → write a `data-mcp-elicitation` part `{ toolCallId, message }` (the card needs the server's message; the approval request only carries the tool input) and return `true`.
2. **`execute` after approval.** Call again: the server is stateless, so this mints a fresh `requestState`. Then retry with `inputResponses` = accept, with each boolean field `true`.
3. **Denied.** Nothing reaches the server, and the model sees `execution-denied` with reason "The user cancelled …". Under MRTR, declining and never retrying are equivalent: nothing is pending server-side.

Supported elicitations: a `requestedSchema` with no properties, or only boolean ones. Any other form, and any non-elicitation input request (sampling, roots), fails the call with an error naming it. The `/api/mcp/answer` fallback isn't needed.

### 7. Bug-report workflow

```
fileBugReport({ log ≤ 20k, note? }) → env.BUG_REPORT.create({ params: { log, note, userId, chatId } })
run(event, step):
  redact  = step.do("redact", …)                          // pure, no model
  draft   = step.do("draft", { retries: 3 }, …)           // structured output → BugDraft
  dupes   = step.do("dedupe", …)                          // issue-tracker search_issues
  verdict = step.waitForEvent("approval", { type: "bug-approval", timeout: "24 hours" })
  result  = step.do("file", …)                            // create_issue { …draft, external_id: instanceId }
GET  /api/workflows/:id           → status, step, draft, dupes, result
POST /api/workflows/:id/decision  → instance.sendEvent({ type: "bug-approval", payload: { decision, edits } })
```

- **Credentials:** no token is ever put in the workflow's parameters or event payloads, because those persist in the instance history. The `file` and `dedupe` steps get credentials through the same source as chat (Decision 5), using the `userId` from the parameters.
- **Role refusal:** a role refusal from `create_issue` throws `NonRetryableError`, giving the `not-permitted` status.
- **Rejected or expired:** these end the run without filing.
- **Who may decide:** the decision route compares the caller's Access identity with the `userId` in the parameters. In development, with no identity, any caller may decide.

*Alternatives:* a screenshot as input (rejected: text-only course); a research report (rejected: it has no human step to teach `waitForEvent`).

**Spike outcome (task 6.1, wrangler 4.112 `wrangler dev`, two-step workflow + `waitForEvent`):**
- `create({ params })`, `get(id)`, `sendEvent({ type, payload })` and `status()` work locally as documented.
- **`status()` is coarse:** `{ status, output, error }` only. There is no current step, and step outputs (the draft, the duplicates) aren't visible until the run completes. Locally, a run waiting on an event reports `running`, not `waiting`. The dev-only `__LOCAL_DEV_STEP_OUTPUTS` field mustn't be relied on.
- **`instance.subscribe()`** (step events with outputs) isn't available in this wrangler version or in the installed `workers-types`.
- **The card's progress therefore needs its own record**, written by the workflow at each step and read by `GET /api/workflows/:id` (see the open question below).
- **`sendEvent` after completion doesn't throw locally**, although the docs say it should. The decision route must check the instance is waiting for approval before sending.
- **`waitForEvent` timeout** throws inside `run` ("Execution timed out after …"). Catching it and returning `{ outcome: "expired" }` ends the instance `complete`.
- **`NonRetryableError`** runs the step exactly once, provided its `name` is left as is. Passing a custom name (the optional second argument) made the runtime retry it as an ordinary error, which showed up in the 6.5 check: Carol's refusal was retried 4 times. Left uncaught, it ends the instance `errored` with a generic `WorkflowFatalError` that loses the reason. So the `file` step's role refusal is caught in `run` and returned as `{ outcome: "not-permitted" }`. Outcomes (`filed`, `rejected`, `expired`, `not-permitted`) are the run's `output`. `errored` means an unexpected failure.

**Decision: progress lives in D1, from lesson 16.** D1 is strongly consistent, so the card never shows a stale step. KV was rejected because it's eventually consistent: the step could lag up to about 60 s when deployed. A Durable Object per run was rejected as a second new concept for this lesson.
- **Table:** `bug_reports (instance_id PK, user_id, chat_id, step, draft JSON, dupes JSON, result JSON, updated_at)`.
- **Writes:** the workflow writes to it inside each step's callback, so a retried step simply rewrites the same row. It also writes `step = 'approval'` in a small step just before `waitForEvent`.
- **Reads:** `GET /api/workflows/:id` reads this row together with `instance.status()`.
- **Ownership:** the starter check uses `bug_reports.user_id` (also kept in the params).
- **Later:** lesson 19 adds its chat tables to the same database, and `chat_workflows` can join to `bug_reports`.

### 8. Persistence (lesson 19)

D1 tables (added to the database lesson 16 introduced for `bug_reports`):
- `chats` (id, user_id, title, token_total, updated_at)
- `messages` (chat_id, seq, ui_message JSON)
- `chat_workflows` (chat_id, instance_id)
- `issue_tracker_tokens` (user_id, refresh_token_enc, access_token_enc, expires_at)

Tokens are encrypted with AES-GCM using a `TOKEN_ENCRYPTION_KEY` secret. The chat route saves the conversation when the stream ends. The sidebar reads `GET /api/chats`.

*As built (8.1–8.3):*
- **Tables:** `0002_chats.sql` adds `chats` and `messages`. `chat_workflows` was dropped: `bug_reports.chat_id` (lesson 16, indexed) already links each run to its chat. A reopened chat brings its card back from the saved `tool-fileBugReport` part, which holds the instance id. `issue_tracker_tokens` comes with the OAuth slice (8.4).
- **Ids and ownership:** The chat id is the client's `useChat` id, so `POST /api/chat` first claims it (insert-if-absent, then compare the owner) and refuses a taken id before any tool or model runs. Locally, the owner is the constant `local`. Deployed without an identity, nothing is saved.
- **No id, no save:** Requests without an id (evals, smoke tests) aren't saved.
- **Saving:** It happens in the outer `createUIMessageStream`'s `onEnd` (with `originalMessages`), so the saved message carries the follow-ups, the title and the usage metadata under the id the client keeps. `consumeSseStream` keeps the stream running to the end if the client disconnects.
- **Routes:** Each chat has a URL (`/c/$chatId`), and `/` redirects to a new one. The route loader reads `GET /api/chats/:id`, where 404 means a new chat. `gcTime: 0` stops a chat from reopening with stale cached messages that the next save would write back.

### 9. Per-user OAuth (lesson 19)

- **CIMD document:** served at `/oauth/client-metadata.json`. An Access application with a bypass policy for that one path keeps it reachable without login; this is configured in the Access dashboard and documented.
- **Login flow:** `/oauth/connect` starts authorization code + PKCE against the issue tracker. `/oauth/callback` stores the tokens.
- **DCR fallback:** if CIMD fails against the server, DCR is used instead. DCR is also the local fallback, since CIMD fetches of `localhost` are refused by `global_fetch_strictly_public`.

*Alternative:* keep using dev tokens when deployed. Impossible: the endpoint is development-only and fails closed.

### 10. Usage and cost (lesson 20)

- **Usage:** `streamText`'s `totalUsage` is attached as message metadata on finish.
- **Prices:** live in a `price` field on each model registry entry (USD per 1M input, cached-input and output tokens). A missing price means "unknown".
- **Token cap:** `chats.token_total` is checked before the model call, and `CHAT_TOKEN_CAP` comes from vars.
- **Caching:** uses AI Gateway's cache headers on eligible requests. Cached tokens come from the provider's usage report.

*Outcome of building 9.1–9.4:*
- **Gateway hits:** Measured with two identical streamed requests: the second returned `cf-aig-cache-status: HIT`, with the original usage replayed (`cached_tokens: 0`). So on a gateway hit, the provider's usage report can't show the caching. `usage.ts` reads the header on each step instead: a HIT counts all of its input as cached and costs $0.
- **Provider prompt caching:** OpenAI's automatic prompt caching (prefixes of 1024+ tokens) is separate. It does come through the usage report (`cacheReadTokens`) and is priced at the cached-input rate.
- **Eligible requests:** Every call to a gateway-routed model (`gateway: true` in the registry), the follow-ups call included. They are sent with `cf-aig-cache-ttl: 3600`. The cache key is the whole request body, so a hit needs an identical conversation, prompt and tool set, and no other user's tool results can come back.
- **What usage covers:** Every model call behind a message: each agent step plus the follow-ups call. That's what the gateway logs. A confirmation continuation adds to the paused half's usage.
- **Token cap:** `chats.token_total` adds each request's input and output tokens. `CHAT_TOKEN_CAP` (200,000) is in `wrangler.jsonc` vars, and the budget is checked before MCP tools load or any model is called. At the cap, the route returns 429 `{ error }`, and the UI shows it.

## Risks / Trade-offs

- [The AI SDK's tool-approval API may not map cleanly onto MRTR retries] → spike first in the lesson-13 slice; fall back to a dedicated `/api/mcp/answer` route if needed.
- [The Workflows API differs from Decision 7's sketch] → spike create / waitForEvent / sendEvent / status before the lesson-16 slice.
- [CIMD fetch is blocked by Access or by strictly-public fetch] → the Access path bypass (deployed); DCR fallback (both).
- [Refresh tokens expire after 7 days, before a long-idle user approves] → the approval window is 24 hours, so this can't happen during one workflow; reconnecting is the documented fix otherwise.
- [Storing OAuth tokens is a security-sensitive addition] → tokens are encrypted at rest, never sent to the browser, and deleted when the user disconnects.

## Migration Plan

Land the slices in lesson order on `main`, each with its tests and docs. Then `course-checkpoint-history` rebuilds the tagged history. Deployed: apply the D1 schema, set the new secrets, configure the Access bypass, then deploy.

## Open Questions

- The exact gateway name and account id for the course's AI Gateway. These are config values and don't change the design.
