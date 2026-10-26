# AGENTS.md

## Project Overview

AI chatbot — pnpm monorepo with three packages, deployed to Cloudflare as a single Worker (Hono API + frontend via Workers Static Assets) at `https://chatbot.course-projects.ai-web.dev` (Workers Custom Domain).

- **`packages/frontend`** — React 19 + Vite, TanStack Router, Tailwind CSS 4, shadcn/ui (radix-nova style, incl. its AI components)
- **`packages/backend`** — Hono on Cloudflare Workers, AI SDK v7, OpenAI + Ollama providers, a Workflow (bug reports) and D1
- **`packages/evals`** — Promptfoo offline evals, Braintrust extension, Langfuse online scoring

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` (root) | Starts backend (wrangler, :8788) + frontend (vite, :5173) via concurrently |
| `pnpm build` (root) | Builds frontend, then backend (backend dry-run bundles `frontend/dist` as assets) |
| `pnpm run deploy` (root) | Build + `wrangler deploy` (not `pnpm deploy` — that's a pnpm built-in) |
| `pnpm eval` (packages/evals) | Run all Promptfoo eval suites |
| `pnpm eval:safety` | Safety suite only |
| `pnpm eval:quality` | Quality suite only |
| `pnpm eval:tools` | Tool use suite only |

Vite proxies `/api` to `localhost:8788` in dev (8787 is left free for the course issue-tracker MCP server). In production the same Worker serves the SPA from static assets (`not_found_handling: single-page-application`) and runs Hono only for `/api/*` (`run_worker_first`) — same origin, so no CORS.

## Backend Subsystems (`packages/backend/src/`)

**Chat route**: `POST /api/chat` — accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream. Model defaults to `gpt-4o-mini`. The bug-report workflow adds `GET /api/workflows/:id` and `POST /api/workflows/:id/decision` (see below).

The system prompt (Team Assistant persona, decoded-content rule, skill catalog) lives in `prompts/system.ts`; bump `SYSTEM_PROMPT_VERSION` when it changes (sent to Langfuse as `prompt_version` metadata).

After the answer streams, the route makes one structured-output call (`structured/followups.ts`, Zod + `Output.object`) and writes a `data-followups` part with three follow-up suggestions, plus a ≤60-char `title` on the first exchange, before finishing the message. Output that fails the schema is dropped silently.

### Providers (`providers.ts`)

Model registry keyed by model ID. Each entry defines `createModel`, optional `providerOptions`, `sendReasoning`, `supportsTools`, and `telemetryId`.

Current models: `gpt-4o-mini` (OpenAI, routed through Cloudflare AI Gateway via `createGatewayOpenAI`), `gemma4:12b` (Ollama with reasoning, called directly).

**To add a model**: add an entry to the `models` record in `providers.ts`.

### Tools (`tools/`)

Local tool registry. Each file exports a named AI SDK `tool()` with a Zod `inputSchema`.

Current tools: `getWeather` (weather.ts), `convertUnits` (convert-units.ts), `executeCode` (execute-code.ts — environment-aware, uses sandbox bindings), `fileBugReport` (file-bug-report.ts — starts the bug-report workflow).

Tools are merged into `streamText()` along with MCP tools, the `loadSkill` tool, and `executeCode`. Tools are skipped entirely when `supportsTools === false` on the model config.

**To add a tool**: create a file in `tools/`, export the tool, register it in `tools/index.ts`.

### MCP Client (`mcp/`)

Connects to external MCP servers and exposes their tools alongside local tools. Two implementations behind one `McpToolLoader` interface:

- `ai-sdk-loader.ts` — uses `@ai-sdk/mcp` `createMCPClient`
- `raw-loader.ts` — hand-rolled dual-era Streamable HTTP client. Tries stateless MCP `2026-07-28` first (per-request `_meta`, `Mcp-Method`/`Mcp-Name`/`Mcp-Param-*` headers, no sessions) and falls back to the legacy `initialize` + `Mcp-Session-Id` flow at `2025-11-25` when the server isn't modern (e.g. DeepWiki). Legacy servers are cached per URL for the isolate's lifetime.

Selected via `MCP_IMPL` env var (default: `"raw"`). Server list is static in `mcp/config.ts`. Remote tools are namespaced as `${serverName}_${toolName}` to prevent collisions.

Current servers: `cf-docs` (Cloudflare Docs), `deepwiki` (DeepWiki), `issue-tracker` (the course's issue-tracker MCP server). Its URL is `ISSUE_TRACKER_URL`: the hosted production tracker in `wrangler.jsonc` vars, and `localhost:8787` (the `mcp-server` repo's `pnpm dev`) under `pnpm dev`.

**Credentials** (`mcp/credentials.ts`): a server entry can have a `credential` source, resolved per request in `loadMcpTools` and merged into its headers. If it returns `null`, the server is skipped. The issue tracker uses the dev-token source: it mints a token from the tracker's development-only `POST /auth/dev-token` for `ISSUE_TRACKER_PERSONA` (`user-alice`/admin, `user-bob`/member (default), `user-carol`/viewer) and caches it until 60 s before expiry. It only runs when `ENVIRONMENT=development`, which `pnpm dev` sets. Don't use the request host to detect local dev: wrangler dev rewrites it to the custom domain.

**MRTR elicitation** (raw loader only): when a server answers `tools/call` with `resultType: "input_required"` + `elicitation/create`, the call pauses for the user through AI SDK tool approval (design §6 of the `course-build-along-features` OpenSpec change):
- The probe call happens in the tool's `needsApproval`. A complete result is cached for `execute`. A confirmation is streamed as a `data-mcp-elicitation` part and returns `true`.
- The UI shows a confirmation card (`components/ai-elements/confirmation.tsx`), and `useChat` resends automatically (`lastAssistantMessageIsCompleteWithApprovalResponses`).
- Approve: `execute` calls again for a fresh `requestState` and retries with `inputResponses` = accept.
- Cancel: the model sees `execution-denied`.
- Supported: confirmations only, meaning an elicitation form that is empty or all booleans. Anything else (other forms, sampling, roots) fails the tool call with an error naming it. The `ai-sdk` loader doesn't support MRTR.

**To add an MCP server**: add an entry to the `mcpServers` array in `mcp/config.ts`.

### Skills (`skills/`)

Agent Skills (agentskills.io spec) — behavioral instructions loaded on demand via a `loadSkill` tool. Each skill is a `SKILL.md` with YAML frontmatter (`name`, `description`) and a markdown body. Imported as raw text at build time via Wrangler module rules.

The system prompt includes a skill catalog. The model calls `loadSkill` when a task matches a skill's description.

Current skills: `eli5-explainer`, `senior-architect`.

**To add a skill**: create a `skills/<name>/SKILL.md`, add a raw import in `discovery.ts`, add the `{ raw, path }` entry to the `rawSkills` array.

### Bug-report workflow (`workflows/`, `routes/workflows.ts`)

A Cloudflare Workflow (`BugReportWorkflow`, binding `BUG_REPORT`) turns a pasted error log into a filed issue. The `fileBugReport` tool starts it and returns the instance id at once.

**Steps:**
1. `redact`: deterministic secret masking (`redact.ts`), no model call.
2. `draft`: structured output to `BugDraft`. Off-schema output throws, so the step retries.
3. `dedupe`: `search_issues` keyword search, ranked by title overlap.
4. `waitForEvent("bug-approval")`: up to `BUG_REPORT_APPROVAL_TIMEOUT` (default 24 h).
5. `file`: `create_issue` with `external_id` = instance id, so a retry returns the same issue.

**Outcomes** are the run's `output`: `filed`, `rejected`, `expired` or `not-permitted`. A role refusal throws `NonRetryableError`; keep its default name, because a custom name makes it retry.

**Rules:**
- Params never hold tokens: steps get issue-tracker credentials from the same credential source as chat.
- Workflows' `status()` is coarse, so the workflow writes its step, draft, duplicates and result to the D1 table `bug_reports` (`progress.ts`, `migrations/0001_bug_reports.sql`).

**Routes:**
- `GET /api/workflows/:id` returns that row plus the status.
- `POST /api/workflows/:id/decision` (`{ decision, edits? }`) is starter-only when deployed and open locally. It checks the run is waiting first, because `sendEvent` doesn't fail on a finished run.

**Local setup:** apply the schema with `npx wrangler d1 migrations apply chatbot --local` (from `packages/backend`). `BUG_REPORT_CHAOS=fail-after-file` (dev only) fails the first filing attempt after the issue exists, to demonstrate idempotent retries.

### Guardrails (`guardrails/`)

Three-tier runtime safety via AI SDK Language Model Middleware. Wraps the model — intercepts every step in the agentic loop (user messages, tool results, model output).

| Tier | Engine | Env value |
|------|--------|-----------|
| `simple` | Regex blocklist + OpenAI Moderation API | `simple` |
| `local` | Llama Guard 3 via Ollama | `local` |
| `cloud` | Llama Guard 3 8B via CF Workers AI | `cloud` |
| disabled | — | `none` |

Selected via `GUARDRAIL_TIER` env var. Streaming uses sentence-level buffering — accumulates text until a sentence boundary, classifies, then releases or halts.

### Telemetry (`telemetry.ts`)

OpenTelemetry → Langfuse via custom `LangfuseFetchExporter` (Workers-compatible `fetch()` instead of Node `http`). Uses `@ai-sdk/otel` for automatic `gen_ai.*` span instrumentation. `SimpleSpanProcessor` (not Batch) because Workers are short-lived. Flush happens in each route's `streamText({ onEnd })` callback via `waitUntil`.

Langfuse **sessions** and **users** are supported via `enrichSpan` + `runtimeContext`. The chat route passes the `chatId` (from `useChat`) as `langfuse.session.id` and the Cloudflare Access user (email, else `sub`, from the verified `Cf-Access-Jwt-Assertion` JWT, see `auth/access.ts`) as `langfuse.user.id` on every span. Requests without that header (local dev, evals) omit the user attribute.

### Auth

Login is enforced at the edge by **Cloudflare Zero Trust Access** (Clerk as the OIDC identity provider), not in the app. The Worker only *reads* identity from the Access JWT for tracing, verifying it against `ACCESS_TEAM_DOMAIN` (issuer + JWKS) and `ACCESS_AUD`. `workers_dev` and `preview_urls` are disabled because those hostnames would bypass Access.

## Frontend (`packages/frontend/src/`)

TanStack Router with routes in `src/routes/`. Chat UI wrappers live in `src/components/ai-elements/`. They keep the old AI SDK Elements export names but are built on shadcn/ui primitives: Trace, Code Block, Message, Bubble, Message Scroller and Dropdown Menu, all in `src/components/ui/`. Add new pieces with `pnpm dlx shadcn@latest add <name>` (style `radix-nova`; see https://ui.shadcn.com/docs/ai-elements), not the deprecated `ai-elements` CLI. `src/app.css` imports `tw-animate-css` and `shadcn/tailwind.css`, which provide the `shimmer`, `data-open` and accordion utilities. `useChat` from `@ai-sdk/react` manages all chat state. No auth code: Cloudflare Access handles sign-in before the SPA loads, and its session cookie rides along on same-origin `/api` calls.

Bug-report runs render as `BugReportCard` (`components/ai-elements/bug-report-card.tsx`), which polls `GET /api/workflows/:id`. Pending run ids are kept in `localStorage`, so a refresh restores their cards (until chats are persisted). Message parts renderer handles: `reasoning` (collapsible trace), `text`, `tool-*` (static tools via `ToolInvocation`), `dynamic-tool` (MCP tools), and `data-followups` (suggestion chips under the latest answer; the first titled message sets the header title via `lib/chat-title.tsx`).

## Evals (`packages/evals/`)

### Promptfoo

Custom provider (`providers/chatbot.ts`) hits the running dev server's `POST /api/chat` endpoint — tests the full stack including middleware, guardrails, tools, and skills.

Three dataset suites in `datasets/`:
- **safety.yaml** — prompt injection, harmful content, jailbreaks, false-positive checks
- **quality.yaml** — factual Q&A, coherence, edge cases
- **tools.yaml** — tool invocation correctness

### CI Thresholds (GitHub Actions)

- Safety: **100%** — non-negotiable
- Quality: **≥ 85%**
- Tool use: **≥ 90%**

PRs are gated on these thresholds. Evals require the dev server running, and the issue-tracker and bug-report cases also need the issue tracker on `:8787`. CI checks out the `mcp-server` repo at `ISSUE_TRACKER_REF` (a course tag, currently `lesson-16`) and runs it locally. That needs the `MCP_SERVER_REPO_TOKEN` secret (a read-only token for that repo) and `AI_GATEWAY_TOKEN`.

### Extensions

- **Braintrust** (`scripts/braintrust-eval.ts`) — same test cases, richer UI dashboard
- **Langfuse online evals** (`scripts/langfuse-evals.ts`) — production trace scoring
- **Garak** — adversarial red teaming (manual, documented in `docs/garak-red-teaming.md`)

## Environment Variables

All backend secrets go in `packages/backend/.dev.vars` (gitignored; start from `.dev.vars.example`) for local dev, CF Worker secrets for production.

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | OpenAI model + moderation API |
| `AI_GATEWAY_ACCOUNT_ID` | Yes | Cloudflare account owning the AI Gateway, set in `wrangler.jsonc` `vars` |
| `AI_GATEWAY_NAME` | Yes | AI Gateway that OpenAI calls are routed through, set in `wrangler.jsonc` `vars` |
| `AI_GATEWAY_TOKEN` | Yes | AI Gateway auth token (sent as `cf-aig-authorization`) |
| `LANGFUSE_PUBLIC_KEY` | Yes | Langfuse telemetry |
| `LANGFUSE_SECRET_KEY` | Yes | Langfuse telemetry |
| `LANGFUSE_BASE_URL` | No | Langfuse region host (default: `https://us.cloud.langfuse.com`) |
| `MCP_IMPL` | No | MCP client: `"raw"` (default) or `"ai-sdk"` |
| `GUARDRAIL_TIER` | No | Guardrail tier: `simple`, `local`, `cloud`, `none` |
| `OLLAMA_BASE_URL` | No | Ollama URL for local guardrails (default: `http://localhost:11434`) |
| `SANDBOX_PROVIDER` | No | Code execution sandbox: `"e2b"`, `"cloudflare"`, or omit for stub |
| `E2B_API_KEY` | No | Required when `SANDBOX_PROVIDER=e2b` |
| `CHATBOT_URL` | No | Eval provider target (default: `http://localhost:8788`) |
| `PROMPTFOO_GRADER_MODEL` | No | LLM-as-judge model (default: `openai:gpt-4o-mini`) |
| `BRAINTRUST_API_KEY` | No | Braintrust eval extension |
| `ENVIRONMENT` | No | `"production"` in `wrangler.jsonc`; `pnpm dev` passes `development`, which enables dev-only behavior such as issue-tracker dev tokens |
| `ISSUE_TRACKER_URL` | No | Issue-tracker MCP endpoint; the hosted tracker in `wrangler.jsonc` `vars`, `http://localhost:8787/mcp` under `pnpm dev` |
| `ISSUE_TRACKER_PERSONA` | No | Local issue-tracker persona: `user-alice` (admin), `user-bob` (member, default), `user-carol` (viewer) |
| `BUG_REPORT_APPROVAL_TIMEOUT` | No | How long a bug report waits for approval (default `24 hours`) |
| `BUG_REPORT_CHAOS` | No | Dev-only fault injection: `fail-after-file` |
| `ACCESS_TEAM_DOMAIN` | No | Cloudflare Access team URL (JWT issuer + JWKS host), set in `wrangler.jsonc` `vars` |
| `ACCESS_AUD` | No | Cloudflare Access application AUD tag, set in `wrangler.jsonc` `vars`; both needed for Langfuse user ids |

## Local Prerequisites

- **Node 22** (see `.nvmrc`)
- **Ollama** on `:11434` — needed for `gemma4:12b` model and `GUARDRAIL_TIER=local`
- **Issue-tracker MCP server** (`mcp-server` repo, `pnpm dev`) on `:8787` — optional; without it the `issue-tracker` tools are skipped
- Evals require the backend dev server running first (`pnpm dev` from root)

## Specs (OpenSpec)

Specs are managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec) (`openspec` CLI, schema `spec-driven`).

- **`openspec/specs/<capability>/spec.md`**: current behavior as requirements and scenarios. Capabilities: `chat-api`, `chat-ui`, `tools`, `mcp-client`, `skills`, `guardrails`, `telemetry`, `auth`, `deployment`, `evals`.
- **`openspec/changes/archive/<date>-<name>/`**: past changes, each with `proposal.md`, `design.md` (architectural rationale and decision logs) and usually `tasks.md`. The pre-OpenSpec design docs and plans from `docs/superpowers/` were moved here. They are historical and may not match current code.

New work goes through an OpenSpec change (`openspec/changes/<name>/` with a proposal, delta specs, design and tasks; `/opsx:propose`), not new files in `docs/superpowers/`. Archive it once it ships, so the main specs stay current. Check with `openspec validate --all --strict`.
