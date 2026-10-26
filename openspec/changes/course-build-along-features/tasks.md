# Tasks

Slices land in lesson order (design §1) so `course-checkpoint-history` can replay them. After every group, `pnpm build` passes and the app runs.

## 1. Scaffold-level changes

- [x] 1.1 Move the backend to port 8788 (wrangler dev, Vite proxy, evals `CHATBOT_URL` default, README, AGENTS.md); verify `pnpm dev` serves chat through `localhost:5173` while the issue-tracker server runs on 8787
- [x] 1.2 Add `packages/backend/.dev.vars.example` covering every variable the backend reads, with placeholders; verify that a fresh clone with the example copied to `.dev.vars` starts, and that `git ls-files` doesn't list `.dev.vars`

## 2. Lesson 07: AI Gateway

- [ ] 2.1 Create OpenAI models through the AI Gateway base URL from vars and secrets (design §3), keeping Ollama direct; verify a chat request appears in the gateway logs and the registry test still lists both models

## 3. Lesson 09: persona prompt

- [x] 3.1 Move the system prompt into `prompts/system.ts` as the Team Assistant persona, keeping the decoded-content rule and the skill catalog; verify the "encoded instruction" safety cases and the quality suite still meet their thresholds

## 4. Lesson 10: structured output

- [x] 4.1 Generate suggestions (and the title on the first exchange) after the stream ends, written as a typed data part (design §4); add unit tests for schema acceptance and rejection, and for "malformed output is dropped silently"
- [x] 4.2 Render the suggestion chips and the title in the header; verify that clicking a chip sends it, and that a later exchange keeps the first title

## 5. Lesson 13: issue tracker over MCP

- [x] 5.1 Spike AI SDK tool approval as the carrier for MRTR answers; record the outcome in design §6 (or switch to the `/api/mcp/answer` fallback)
- [x] 5.2 Add per-server credential sources and the development dev-token source with `ISSUE_TRACKER_PERSONA` (design §5); add tests: token minted on first use, reused before expiry, re-minted after
- [x] 5.3 Add the `issue-tracker` entry to the server list; verify "list open issues in the demo project" calls an `issue-tracker_*` tool and returns the seeded issues
- [x] 5.4 Return elicitations as `input-required` tool results and retry with `inputResponses` (design §6); add unit tests for the confirm, cancel and unsupported-input paths
- [x] 5.5 Add the confirmation card; verify `delete_project` through the chat asks first, that cancel leaves the project, and that approve deletes it (then reset the demo data)
- [x] 5.6 Update the `mcp-client` section of AGENTS.md and the backend README (issue tracker, personas, `ISSUE_TRACKER_PERSONA`); verify the documented steps work from a fresh clone

## 6. Lesson 16: bug-report workflow

- [x] 6.1 Spike Workflows create / waitForEvent / sendEvent / status with a two-step workflow in `wrangler dev`; record any API differences in design §7
- [x] 6.2 Add the Workflow and D1 bindings, the `bug_reports` progress table, and `BugReportWorkflow` with redact, draft, dedupe, approval and file (design §7); add unit tests for redaction (keys, bearer tokens, emails, IPs) and the `BugDraft` schema
- [x] 6.3 Add the `fileBugReport` tool, `GET /api/workflows/:id` and `POST /api/workflows/:id/decision` with the starter-only check; add tests for the decision authorization
- [x] 6.4 Add the workflow card; verify end to end: paste a log, refresh, the card is restored from the instance id, approve, exactly one issue is filed
- [x] 6.5 Verify the failure paths: a forced retry of `file` files no second issue (needs mcp-server `idempotent-issue-creation`); reject → `rejected`; timeout (shortened in dev) → `expired`; `ISSUE_TRACKER_PERSONA=user-carol` → `not-permitted` after one attempt
- [x] 6.6 Document the workflow in AGENTS.md and the README; verify the documented flow works as written

## 7. Lessons 17–18: guardrails and evals

- [x] 7.1 Add the evals cases: issue-tracker tool use, the bug-report tool call, and redaction (spec `evals`); verify `pnpm eval` meets every threshold

## 8. Lesson 19: persistence and deployed OAuth

- [ ] 8.1 Add the chat tables to the D1 schema (design §8; the binding and apply command exist from 6.2); verify a fresh local database is created by the documented command
- [ ] 8.2 Save conversations on stream end and load them by id, scoped to the user; add tests for ownership refusal
- [ ] 8.3 Add the history sidebar and `GET /api/chats`; verify that reload restores a conversation, that the sidebar lists titled chats, and that reopening a chat restores its pending workflow card
- [ ] 8.4 Serve `/oauth/client-metadata.json`; add `/oauth/connect` and `/oauth/callback` (PKCE) and the encrypted token store (design §8–9); add tests for encryption round-trip and the refresh-on-expiry path
- [ ] 8.5 Use the per-user credential source when deployed, and offer "connect issue tracker" when it's missing; route the workflow's `dedupe` and `file` steps through it
- [ ] 8.6 Configure the Access bypass for the client-metadata path and document it; verify on the deployed app that an unauthenticated `curl` gets the JSON while `/` still requires login
- [ ] 8.7 Verify deployed end to end: connect as Bob, file a bug from a log, approve, one issue exists on the hosted issue tracker; connect as Carol → `not-permitted`

## 9. Lesson 20: usage and cost

- [ ] 9.1 Attach `totalUsage` as message metadata, and add `price` to registry entries (design §10); add unit tests for summing steps and for "no price → unknown"
- [ ] 9.2 Add the cost meter in the header; verify it matches gateway-reported tokens for a sample conversation
- [ ] 9.3 Enforce `CHAT_TOKEN_CAP` using `chats.token_total`; verify that exceeding it makes no model call and shows the budget message
- [ ] 9.4 Enable gateway caching for eligible requests; verify a repeated request reports cached tokens and a lower estimate
- [ ] 9.5 Update AGENTS.md, the README and `.dev.vars.example` for everything added in groups 8–9; verify setup from a fresh clone
