# AGENTS.md

## Project Overview

AI chatbot — pnpm monorepo with three packages, deployed to Cloudflare as a single Worker (Hono API + frontend via Workers Static Assets) at `https://chatbot.course-projects.ai-web.dev` (Workers Custom Domain).

- **`packages/frontend`** — React 19 + Vite, TanStack Router, Tailwind CSS 4, shadcn/ui (radix-nova style, incl. its AI components)
- **`packages/backend`** — Hono on Cloudflare Workers, AI SDK v7, OpenAI + Ollama providers
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

**Single API route**: `POST /api/chat` — accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream. Model defaults to `gpt-4o-mini`.

### Providers (`providers.ts`)

Model registry keyed by model ID. Each entry defines `createModel`, optional `providerOptions`, `sendReasoning`, `supportsTools`, and `telemetryId`.

Current models: `gpt-4o-mini` (OpenAI, routed through Cloudflare AI Gateway via `createGatewayOpenAI`), `gemma4:12b` (Ollama with reasoning, called directly).

**To add a model**: add an entry to the `models` record in `providers.ts`.

### Tools (`tools/`)

Local tool registry. Each file exports a named AI SDK `tool()` with a Zod `inputSchema`.

Current tools: `getWeather` (weather.ts), `convertUnits` (convert-units.ts), `executeCode` (execute-code.ts — environment-aware, uses sandbox bindings).

Tools are merged into `streamText()` along with MCP tools, the `loadSkill` tool, and `executeCode`. Tools are skipped entirely when `supportsTools === false` on the model config.

**To add a tool**: create a file in `tools/`, export the tool, register it in `tools/index.ts`.

### MCP Client (`mcp/`)

Connects to external MCP servers and exposes their tools alongside local tools. Two implementations behind one `McpToolLoader` interface:

- `ai-sdk-loader.ts` — uses `@ai-sdk/mcp` `createMCPClient`
- `raw-loader.ts` — hand-rolled dual-era Streamable HTTP client. Tries stateless MCP `2026-07-28` first (per-request `_meta`, `Mcp-Method`/`Mcp-Name`/`Mcp-Param-*` headers, no sessions) and falls back to the legacy `initialize` + `Mcp-Session-Id` flow at `2025-11-25` when the server isn't modern (e.g. DeepWiki). Legacy servers are cached per URL for the isolate's lifetime.

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

Langfuse **sessions** and **users** are supported via `enrichSpan` + `runtimeContext`. The chat route passes the `chatId` (from `useChat`) as `langfuse.session.id` and the Cloudflare Access user (email, else `sub`, from the verified `Cf-Access-Jwt-Assertion` JWT, see `auth/access.ts`) as `langfuse.user.id` on every span. Requests without that header (local dev, evals) omit the user attribute.

### Auth

Login is enforced at the edge by **Cloudflare Zero Trust Access** (Clerk as the OIDC identity provider), not in the app. The Worker only *reads* identity from the Access JWT for tracing, verifying it against `ACCESS_TEAM_DOMAIN` (issuer + JWKS) and `ACCESS_AUD`. `workers_dev` and `preview_urls` are disabled because those hostnames would bypass Access.

## Frontend (`packages/frontend/src/`)

TanStack Router with routes in `src/routes/`. Chat UI wrappers live in `src/components/ai-elements/`. They keep the old AI SDK Elements export names but are built on shadcn/ui primitives: Trace, Code Block, Message, Bubble, Message Scroller and Dropdown Menu, all in `src/components/ui/`. Add new pieces with `pnpm dlx shadcn@latest add <name>` (style `radix-nova`; see https://ui.shadcn.com/docs/ai-elements), not the deprecated `ai-elements` CLI. `src/app.css` imports `tw-animate-css` and `shadcn/tailwind.css`, which provide the `shimmer`, `data-open` and accordion utilities. `useChat` from `@ai-sdk/react` manages all chat state. No auth code: Cloudflare Access handles sign-in before the SPA loads, and its session cookie rides along on same-origin `/api` calls.

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
| `ACCESS_TEAM_DOMAIN` | No | Cloudflare Access team URL (JWT issuer + JWKS host), set in `wrangler.jsonc` `vars` |
| `ACCESS_AUD` | No | Cloudflare Access application AUD tag, set in `wrangler.jsonc` `vars`; both needed for Langfuse user ids |

## Local Prerequisites

- **Node 22** (see `.nvmrc`)
- **Ollama** on `:11434` — needed for `gemma4:12b` model and `GUARDRAIL_TIER=local`
- Evals require the backend dev server running first (`pnpm dev` from root)

## Specs (OpenSpec)

Specs are managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec) (`openspec` CLI, schema `spec-driven`).

- **`openspec/specs/<capability>/spec.md`**: current behavior as requirements and scenarios. Capabilities: `chat-api`, `chat-ui`, `tools`, `mcp-client`, `skills`, `guardrails`, `telemetry`, `auth`, `deployment`, `evals`.
- **`openspec/changes/archive/<date>-<name>/`**: past changes, each with `proposal.md`, `design.md` (architectural rationale and decision logs) and usually `tasks.md`. The pre-OpenSpec design docs and plans from `docs/superpowers/` were moved here. They are historical and may not match current code.

New work goes through an OpenSpec change (`openspec/changes/<name>/` with a proposal, delta specs, design and tasks; `/opsx:propose`), not new files in `docs/superpowers/`. Archive it once it ships, so the main specs stay current. Check with `openspec validate --all --strict`.
