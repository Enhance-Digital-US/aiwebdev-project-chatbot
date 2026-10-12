# AGENTS.md

## Project Overview

AI chatbot — pnpm monorepo with three packages, deployed to Cloudflare as a single Worker (Hono API + frontend via Workers Static Assets) at `https://chatbot.course-projects.ai-web.dev` (Workers Custom Domain).

- **`packages/frontend`** — React 19 + Vite, TanStack Router, Tailwind CSS 4, shadcn/ui + AI Elements
- **`packages/backend`** — Hono on Cloudflare Workers, AI SDK v7, OpenAI + Ollama providers
- **`packages/evals`** — Promptfoo offline evals, Braintrust extension, Langfuse online scoring

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` (root) | Starts backend (wrangler, :8787) + frontend (vite, :5173) via concurrently |
| `pnpm build` (root) | Builds frontend, then backend (backend dry-run bundles `frontend/dist` as assets) |
| `pnpm run deploy` (root) | Build + `wrangler deploy` (not `pnpm deploy` — that's a pnpm built-in) |
| `pnpm eval` (packages/evals) | Run all Promptfoo eval suites |
| `pnpm eval:safety` | Safety suite only |
| `pnpm eval:quality` | Quality suite only |
| `pnpm eval:tools` | Tool use suite only |

Vite proxies `/api` to `localhost:8787` in dev. In production the same Worker serves the SPA from static assets (`not_found_handling: single-page-application`) and runs Hono only for `/api/*` (`run_worker_first`) — same origin, so no CORS.

## Backend Subsystems (`packages/backend/src/`)

**Single API route**: `POST /api/chat` — accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream. Model defaults to `gpt-4o-mini`.

### Providers (`providers.ts`)

Model registry keyed by model ID. Each entry defines `createModel`, optional `providerOptions`, `sendReasoning`, `supportsTools`, and `telemetryId`.

Current models: `gpt-4o-mini` (OpenAI), `gemma4:12b` (Ollama with reasoning).

**To add a model**: add an entry to the `models` record in `providers.ts`.

### Tools (`tools/`)

Local tool registry. Each file exports a named AI SDK `tool()` with a Zod `inputSchema`.

Current tools: `getWeather` (weather.ts), `convertUnits` (convert-units.ts), `executeCode` (execute-code.ts — environment-aware, uses sandbox bindings).

Tools are merged into `streamText()` along with MCP tools, the `loadSkill` tool, and `executeCode`. Tools are skipped entirely when `supportsTools === false` on the model config.

**To add a tool**: create a file in `tools/`, export the tool, register it in `tools/index.ts`.

### MCP Client (`mcp/`)

Connects to external MCP servers and exposes their tools alongside local tools. Two implementations behind one `McpToolLoader` interface:

- `ai-sdk-loader.ts` — uses `@ai-sdk/mcp` `createMCPClient`
- `raw-loader.ts` — hand-rolled Streamable HTTP client (~200 lines)

Selected via `MCP_IMPL` env var (default: `"raw"`). Server list is static in `mcp/config.ts`. Remote tools are namespaced as `${serverName}_${toolName}` to prevent collisions.

Current servers: `cf-docs` (Cloudflare Docs), `deepwiki` (DeepWiki).

**To add an MCP server**: add an entry to the `mcpServers` array in `mcp/config.ts`.

### Skills (`skills/`)

Agent Skills (agentskills.io spec) — behavioral instructions loaded on demand via a `loadSkill` tool. Each skill is a `SKILL.md` with YAML frontmatter (`name`, `description`) and a markdown body. Imported as raw text at build time via Wrangler module rules.

The system prompt includes a skill catalog. The model calls `loadSkill` when a task matches a skill's description.

Current skills: `eli5-explainer`, `senior-architect`.

**To add a skill**: create a `skills/<name>/SKILL.md`, add a raw import in `discovery.ts`, add the `{ raw, path }` entry to the `rawSkills` array.

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

Langfuse **sessions** and **users** are supported via `enrichSpan` + `runtimeContext`. The chat route passes the `chatId` (from `useChat`) as `langfuse.session.id` and the Clerk `userId` (if authenticated) as `langfuse.user.id` on every span. Auth is optional — traces without a signed-in user simply omit the user attribute.

## Frontend (`packages/frontend/src/`)

TanStack Router with routes in `src/routes/`. AI Elements components in `src/components/ai-elements/` (owned source, shadcn model). `useChat` from `@ai-sdk/react` manages all chat state. Optional Clerk auth (`@clerk/react`) wraps the app when `VITE_CLERK_PUBLISHABLE_KEY` is set — provides sign-in UI and forwards session tokens to the backend.

Message parts renderer handles: `reasoning` (collapsible trace), `text`, `tool-*` (static tools via `ToolInvocation`), `dynamic-tool` (MCP tools).

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

PRs are gated on these thresholds. Evals require the dev server running.

### Extensions

- **Braintrust** (`scripts/braintrust-eval.ts`) — same test cases, richer UI dashboard
- **Langfuse online evals** (`scripts/langfuse-evals.ts`) — production trace scoring
- **Garak** — adversarial red teaming (manual, documented in `docs/garak-red-teaming.md`)

## Environment Variables

All backend secrets go in `packages/backend/.dev.vars` (gitignored) for local dev, CF Worker secrets for production.

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | OpenAI model + moderation API |
| `LANGFUSE_PUBLIC_KEY` | Yes | Langfuse telemetry |
| `LANGFUSE_SECRET_KEY` | Yes | Langfuse telemetry |
| `LANGFUSE_BASE_URL` | No | Langfuse region host (default: `https://us.cloud.langfuse.com`) |
| `MCP_IMPL` | No | MCP client: `"raw"` (default) or `"ai-sdk"` |
| `GUARDRAIL_TIER` | No | Guardrail tier: `simple`, `local`, `cloud`, `none` |
| `OLLAMA_BASE_URL` | No | Ollama URL for local guardrails (default: `http://localhost:11434`) |
| `SANDBOX_PROVIDER` | No | Code execution sandbox: `"e2b"`, `"cloudflare"`, or omit for stub |
| `E2B_API_KEY` | No | Required when `SANDBOX_PROVIDER=e2b` |
| `CHATBOT_URL` | No | Eval provider target (default: `http://localhost:8787`) |
| `PROMPTFOO_GRADER_MODEL` | No | LLM-as-judge model (default: `openai:gpt-4o-mini`) |
| `BRAINTRUST_API_KEY` | No | Braintrust eval extension |
| `CLERK_SECRET_KEY` | No | Clerk auth — enables user tracking in Langfuse |
| `CLERK_PUBLISHABLE_KEY` | No | Clerk auth — required alongside `CLERK_SECRET_KEY` |
| `CLERK_AUTHORIZED_PARTIES` | No | Comma-separated origins allowed as Clerk token `azp` (prod in `wrangler.jsonc`, `http://localhost:5173` in `.dev.vars`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | No | Frontend Clerk auth — inlined at **build time** (frontend `.env.production`); `pk_live_` needs a custom domain |

## Local Prerequisites

- **Node 22** (see `.nvmrc`)
- **Ollama** on `:11434` — needed for `gemma4:12b` model and `GUARDRAIL_TIER=local`
- Evals require the backend dev server running first (`pnpm dev` from root)

## Design Specs

Detailed design documents live in `docs/superpowers/specs/`. Consult these for architectural rationale and decision logs.
