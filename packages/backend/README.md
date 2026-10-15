# Chatbot API Backend

Hono + Cloudflare Workers backend with AI SDK v7, multi-provider model support, MCP tool federation, agent skills, three-tier guardrails, sandboxed code execution, and Langfuse observability via OpenTelemetry.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Langfuse account](https://cloud.langfuse.com) (US region)
- (Optional) [Ollama](https://ollama.com) on `:11434` — for `gemma4:12b` model and local guardrails
- (Optional) [E2B API key](https://e2b.dev) — for sandboxed code execution

## Local Development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Create `packages/backend/.dev.vars` (gitignored):

```env
OPENAI_API_KEY=sk-proj-your-openai-key
LANGFUSE_PUBLIC_KEY=pk-lf-your-langfuse-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-langfuse-secret-key

# Optional — MCP client implementation ("raw" or "ai-sdk", default: "raw")
MCP_IMPL=raw

# Optional — Guardrail tier ("simple", "local", "cloud", or "none", default: "none")
GUARDRAIL_TIER=simple

# Optional — Sandbox code execution ("e2b", "cloudflare", or omit for stub)
SANDBOX_PROVIDER=e2b
E2B_API_KEY=e2b_your-api-key
```

Get your Langfuse keys from: **Langfuse Dashboard → Settings → API Keys**

### 3. Start the dev server

```bash
pnpm --filter backend dev
```

The API runs at `http://localhost:8787`.

### 4. Test

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

After a successful request, check your [Langfuse dashboard](https://us.cloud.langfuse.com) — you should see a trace with:
- Model: `gpt-4o-mini`
- Non-zero input/output token counts
- Prompt and completion content

## Deploy to Cloudflare Workers

### Step 1: Authenticate with Cloudflare

If you haven't already, log in to Cloudflare via Wrangler:

```bash
npx wrangler login
```

This opens a browser window for OAuth. Once authenticated, Wrangler stores your credentials locally.

### Step 2: Set production secrets

Secrets are encrypted and stored by Cloudflare — they're never in your code or config files. Run from `packages/backend`:

```bash
# Required — run each command and paste the key value when prompted:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put LANGFUSE_PUBLIC_KEY
npx wrangler secret put LANGFUSE_SECRET_KEY

# Required while SANDBOX_PROVIDER="e2b" (otherwise executeCode returns an error):
npx wrangler secret put E2B_API_KEY

# Optional — only if your Langfuse project is not in the US region:
npx wrangler secret put LANGFUSE_BASE_URL   # e.g. https://cloud.langfuse.com
```

Non-secret config (`MCP_IMPL`, `SANDBOX_PROVIDER`, `GUARDRAIL_TIER`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) is set via `vars` in `wrangler.jsonc`. `.dev.vars` is **not** uploaded on deploy.

To verify secrets are set:

```bash
npx wrangler secret list
```

### Step 3: Review `wrangler.jsonc`

The app ships as a **single Worker**: the Vite build in `packages/frontend/dist` is served via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), and only `/api/*` invokes the Hono app.

```jsonc
"assets": {
  "directory": "../frontend/dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

Key points:
- **`assets`** — static files are served without invoking the Worker (free, no CPU time). Unknown paths fall back to `index.html` so client-side routes work on refresh. `run_worker_first` sends `/api/*` to Hono even if an asset path matches.
- **Same origin** — frontend and API share a hostname, so no CORS config is needed and the Cloudflare Access session cookie covers both.
- **`workers_dev: false` / `preview_urls: false`** — the custom domain is the only public origin. Access protects that hostname; a `*.workers.dev` or preview URL would bypass login.
- **`nodejs_compat`** is required — the OTel packages use Node APIs (`Buffer`, `process.hrtime`) that this flag polyfills in Workers.
- **`compatibility_date`** — must not exceed what the installed Wrangler's `workerd` supports (`wrangler dev` errors if it does). Bump it alongside Wrangler upgrades.
- **`ai` binding** — provides the `AI` binding for the `cloud` guardrail tier (Llama Guard via Workers AI).
- **`GUARDRAIL_TIER`** defaults to `simple` in production. `local` cannot work deployed (no Ollama at the edge).
- **`rules`** — the `Text` rule for `**/*.md` enables raw-importing SKILL.md files at build time.
- **`observability.enabled`** turns on Workers Logs only. There is deliberately no `observability.traces` — Workers native tracing creates a separate trace tree from `@opentelemetry/api`, which would send Langfuse disconnected duplicate traces.

### Step 4: Authentication (Cloudflare Access)

Login is enforced **outside the app** by a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) self-hosted application on `chatbot.course-projects.ai-web.dev`, with Clerk configured as an OIDC identity provider in Zero Trust. Unauthenticated requests (including `/api/*`) get a 302 to `enhancedigital.cloudflareaccess.com` before they reach the Worker. The app has no auth code or keys of its own.

For tracing, the Worker reads the user from the signed `Cf-Access-Jwt-Assertion` header that Access adds (`src/auth/access.ts`). It verifies the JWT against the team's JWKS (`<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`), issuer `ACCESS_TEAM_DOMAIN`, and audience `ACCESS_AUD` (the Access application's AUD tag). It then sets `langfuse.user.id` to the `email` claim, falling back to `sub`. A missing or invalid token leaves the request anonymous. Local dev and evals send no header, so their traces omit the user.

> If the Access application is recreated, its AUD tag changes: update `ACCESS_AUD` in `wrangler.jsonc` (Zero Trust → Access → Applications → the app → Overview → Application Audience (AUD) Tag).

### Step 5: Deploy

From the repo root:

```bash
pnpm run deploy
```

This builds the frontend, then the backend, then runs `wrangler deploy`. Use `pnpm run deploy`, not `pnpm deploy` — the latter is pnpm's built-in workspace-deploy command.

Wrangler outputs the production URL:

```
Uploaded chatbot (x.xx sec)
Deployed chatbot triggers (x.xx sec)
  chatbot.course-projects.ai-web.dev (custom domain)
```

The first deploy creates the DNS record and certificate for `chatbot.course-projects.ai-web.dev`; allow a few minutes before the hostname serves over HTTPS.

Other course projects follow the same pattern: each Worker gets its own `<project>.course-projects.ai-web.dev` custom domain, so each is a separate origin (cookies, storage and auth sessions stay isolated).

The `gemma4:12b` (Ollama) model is hidden from the production UI and is unreachable from the edge.

### Step 6: Verify in Langfuse

1. Send a request to your production endpoint
2. Open [Langfuse US dashboard](https://us.cloud.langfuse.com)
3. Navigate to **Traces** — you should see a trace for each request
4. Click into a trace to verify:
   - **Model:** `gpt-4o-mini` (or `gemma4:12b` for Ollama route)
   - **Input tokens:** non-zero count
   - **Output tokens:** non-zero count
   - **Prompt/Completion:** visible (unless disabled via `recordInputs`/`recordOutputs`)

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/chat` | POST | Accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream |

The `model` field defaults to `gpt-4o-mini`. Available models are registered in `providers.ts`:

| Model ID | Provider | Notes |
|----------|----------|-------|
| `gpt-4o-mini` | OpenAI | Default, supports tools |
| `gemma4:12b` | Ollama (local) | Reasoning enabled, requires Ollama running |

## MCP — Remote Tool Federation

The chatbot connects to external [Model Context Protocol](https://modelcontextprotocol.io/) servers and exposes their tools alongside local tools. This lets the model call remote APIs (search docs, query knowledge bases) without custom tool implementations.

### Architecture

Two interchangeable MCP client implementations behind a common `McpToolLoader` interface:

| Implementation | File | Description |
|---------------|------|-------------|
| **Raw** (default) | `mcp/raw-loader.ts` | Hand-rolled Streamable HTTP client (~150 lines). Handles both plain JSON and SSE JSON-RPC responses. |
| **AI SDK** | `mcp/ai-sdk-loader.ts` | Uses `@ai-sdk/mcp` `createMCPClient` |

Selected via the `MCP_IMPL` env var (default: `"raw"`).

### Configured Servers

Defined in `mcp/config.ts`:

| Server | URL | Purpose |
|--------|-----|---------|
| `cf-docs` | `https://docs.mcp.cloudflare.com/mcp` | Cloudflare documentation search |
| `deepwiki` | `https://mcp.deepwiki.com/mcp` | Open-source project knowledge base |

Remote tools are namespaced as `${serverName}_${toolName}` to prevent collisions with local tools.

### Connection Handling

- All servers connect in parallel with a **5-second timeout** per server
- Failed connections log a warning and are skipped — the chatbot continues with available tools
- Sessions are cleaned up via `DELETE` in the `onEnd` callback (deferred with `waitUntil`)

### Adding an MCP Server

Add an entry to the `mcpServers` array in `mcp/config.ts`:

```typescript
{
  name: "my-server",
  url: "https://my-server.example.com/mcp",
  enabled: true,
}
```

## Skills — On-Demand Behavioral Instructions

Skills are behavioral instruction sets (following the [agentskills.io](https://agentskills.io) spec) that the model loads on demand via a `loadSkill` tool call. They modify how the model responds without changing the underlying model or system prompt permanently.

### How It Works

1. The system prompt includes a **skill catalog** listing available skills and their descriptions
2. When a user's request matches a skill, the model calls `loadSkill({ name: "skill-name" })`
3. The tool returns the skill's markdown instructions, which the model follows for subsequent responses

### Available Skills

| Skill | Description |
|-------|-------------|
| `eli5-explainer` | Explains concepts using simple everyday analogies, short sentences, and no unexplained jargon |
| `senior-architect` | Responds as a production-focused architect — leads with trade-offs, considers failure modes, references industry patterns |

### Skill Format

Each skill is a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: One-line description the model uses to decide when to load this skill.
---

# Instructions

Markdown body with behavioral instructions...
```

Skills are imported as raw text at build time via Wrangler module rules (`"type": "Text"` for `**/*.md`).

### Adding a Skill

1. Create `skills/<name>/SKILL.md` with frontmatter and instructions
2. Add a raw import in `skills/discovery.ts`
3. Add the `{ raw, path }` entry to the `rawSkills` array

## Guardrails — Runtime Safety

Three-tier runtime content safety system implemented as [AI SDK Language Model Middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware). The middleware wraps the model and intercepts every step in the agentic loop — user messages, tool results, and model output.

### Tiers

| Tier | Engine | When to Use |
|------|--------|-------------|
| `simple` | Regex blocklist + [OpenAI Moderation API](https://platform.openai.com/docs/guides/moderation) | Fast, low-cost, good default for production |
| `local` | [Llama Guard 3](https://ai.meta.com/research/publications/llama-guard-llm-based-input-output-safeguard-for-human-ai-conversations/) via Ollama | Full classification, no external API calls, requires Ollama |
| `cloud` | Llama Guard 3 8B via [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) | Full classification at the edge, no local GPU needed |
| `none` | Disabled | No safety checks (default) |

Selected via the `GUARDRAIL_TIER` env var.

### How It Works

**Input checking** (`transformParams`): Before each model call, new messages (user input and tool results) are extracted and classified. If unsafe content is detected, the request is rejected with a descriptive error naming the violated categories.

**Output checking** (`wrapStream`): The model's streaming output is filtered in real-time:
- **Regex fast-path**: Each text delta is checked against injection/blocklist patterns for instant filtering
- **Sentence-level buffering**: Text accumulates until a sentence boundary (`.` `!` `?` followed by whitespace, or `\n\n`), then the complete sentence is released — this prevents partial-sentence false positives

### Safety Categories (Llama Guard)

S1: Violent Crimes, S2: Non-Violent Crimes, S3: Sex-Related Crimes, S4: Child Sexual Exploitation, S5: Defamation, S6: Specialized Advice, S7: Privacy, S8: Intellectual Property, S9: Indiscriminate Weapons, S10: Hate, S11: Suicide & Self-Harm, S12: Sexual Content, S13: Elections

### Simple Tier Details

The `simple` tier combines two checks:

1. **Regex patterns** — prompt injection attempts (`ignore previous instructions`, `reveal your system prompt`, `bypass restrictions`, etc.) and harmful content blocklist
2. **OpenAI Moderation API** — broad content policy classification (hate, violence, self-harm, sexual content, etc.)

Regex runs first (synchronous, zero latency); OpenAI Moderation only fires if regex passes.

## Sandbox Code Execution

The `executeCode` tool lets the model run user code in a secure, isolated sandbox. Supports Python and JavaScript.

### Providers

| Provider | Env Value | Description |
|----------|-----------|-------------|
| [E2B](https://e2b.dev) | `e2b` | Cloud sandboxes with 30s creation timeout, 15s execution timeout |
| [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) | `cloudflare` | Durable Object-based sandboxes at the edge |
| Stub | _(default)_ | Simulated output for development — no real execution |

Selected via the `SANDBOX_PROVIDER` env var. E2B requires `E2B_API_KEY`. Cloudflare requires a `SANDBOX` Durable Object binding in `wrangler.jsonc`.

### How It Works

1. The model decides code execution is needed (e.g., math computation, data analysis, code testing)
2. It calls `executeCode({ code: "...", language: "python" })`
3. The tool creates a sandbox, writes the code to a file, executes it, and returns `{ stdout, stderr, exitCode }`
4. The sandbox is destroyed after execution

### Local Tools Summary

| Tool | File | Description |
|------|------|-------------|
| `getWeather` | `tools/weather.ts` | Weather information lookup |
| `convertUnits` | `tools/convert-units.ts` | Unit conversion |
| `executeCode` | `tools/execute-code.ts` | Sandboxed code execution (Python/JavaScript) |
| `loadSkill` | `skills/load-skill.ts` | Load behavioral skill instructions |

MCP remote tools are merged alongside these. Tools are skipped entirely when `supportsTools === false` on the model config (e.g., models that don't support function calling).

## Project Structure

```
packages/backend/
├── src/
│   ├── index.ts           # Hono app entry point
│   ├── providers.ts       # Model registry (OpenAI, Ollama)
│   ├── telemetry.ts       # Langfuse OTLP exporter, flush
│   ├── routes/
│   │   └── chat.ts        # POST /api/chat — orchestrates all subsystems
│   ├── tools/
│   │   ├── index.ts       # Local tool registry
│   │   ├── weather.ts     # getWeather tool
│   │   ├── convert-units.ts # convertUnits tool
│   │   └── execute-code.ts  # executeCode tool (E2B / CF Sandbox / stub)
│   ├── mcp/
│   │   ├── config.ts      # MCP server list
│   │   ├── index.ts       # loadMcpTools orchestrator
│   │   ├── raw-loader.ts  # Streamable HTTP MCP client
│   │   ├── ai-sdk-loader.ts # @ai-sdk/mcp client
│   │   └── types.ts       # McpToolLoader interface
│   ├── skills/
│   │   ├── discovery.ts   # Skill parsing, catalog, prompt builder
│   │   ├── load-skill.ts  # loadSkill tool definition
│   │   ├── eli5-explainer/SKILL.md
│   │   └── senior-architect/SKILL.md
│   └── guardrails/
│       ├── index.ts       # Tier selection factory
│       ├── middleware.ts   # LanguageModelMiddleware (input + stream)
│       ├── checker.ts     # SafetyChecker interface, Llama Guard parser
│       ├── simple.ts      # Regex + OpenAI Moderation
│       ├── local.ts       # Llama Guard via Ollama
│       └── cloud.ts       # Llama Guard via CF Workers AI
├── .dev.vars              # Local secrets (gitignored)
├── package.json
├── tsconfig.json
└── wrangler.jsonc         # Cloudflare Workers config
```

## Observability Architecture

```
streamText() → @ai-sdk/otel → BasicTracerProvider → SimpleSpanProcessor
                                                          │
                                                          ▼
                                               LangfuseFetchExporter
                                                    (fetch API)
                                                          │
                                                          ▼
                                    POST https://us.cloud.langfuse.com/api/public/otel/v1/traces
```

- **`@ai-sdk/otel`** auto-instruments all `streamText`/`generateText` calls with `gen_ai.*` semantic convention spans
- **`SimpleSpanProcessor`** exports immediately on span end (no batching timers — correct for serverless)
- **`LangfuseFetchExporter`** uses Workers-native `fetch()` with Basic auth
- **Flush** happens in each route's `onEnd` callback via `waitUntil()` — ensures spans have complete token counts before export

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | Yes | — | OpenAI model + moderation API (simple guardrail tier) |
| `LANGFUSE_PUBLIC_KEY` | Yes | — | Langfuse telemetry |
| `LANGFUSE_SECRET_KEY` | Yes | — | Langfuse telemetry |
| `MCP_IMPL` | No | `raw` | MCP client implementation: `"raw"` or `"ai-sdk"` |
| `GUARDRAIL_TIER` | No | `none` | Safety tier: `"simple"`, `"local"`, `"cloud"`, or `"none"` |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama URL for local guardrails and gemma4 model |
| `SANDBOX_PROVIDER` | No | stub | Code execution sandbox: `"e2b"`, `"cloudflare"`, or omit for stub |
| `E2B_API_KEY` | No | — | Required when `SANDBOX_PROVIDER=e2b` |

## Disabling Prompt/Completion Logging

By default, prompts and completions are sent to Langfuse. To disable per-call:

```typescript
streamText({
  model: openai("gpt-4o-mini"),
  messages,
  telemetry: {
    functionId: "openai-chat",
    recordInputs: false,
    recordOutputs: false,
  },
});
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No traces in Langfuse | Placeholder or wrong keys in `.dev.vars` | Replace with real keys from Langfuse dashboard |
| `Uncaught [object Array]` in wrangler logs | Flush promise rejection (auth failure) | Already handled by `.catch(() => {})` in `flushTelemetry()` |
| Token counts show 0 | Flush happening before stream completes | Ensure flush is in `onEnd` callback, not post-middleware |
| Two disconnected traces per request | Workers native tracing enabled | Remove `[observability.traces]` from `wrangler.jsonc` |
| Build error: cannot resolve OTel packages | Missing direct dependencies | Run `pnpm --filter backend add @opentelemetry/resources @opentelemetry/core` |
| MCP server "X" unavailable | Server down or timed out (5s) | Check the server URL in `mcp/config.ts`; set `enabled: false` to skip |
| `Content blocked by guardrails: ...` | Input classified as unsafe | Expected behavior — review the flagged categories in the error message |
| Guardrails not running | `GUARDRAIL_TIER` not set | Defaults to `"none"` — set to `"simple"`, `"local"`, or `"cloud"` in `.dev.vars` |
| `E2B_API_KEY is not set` | Using E2B sandbox without API key | Set `E2B_API_KEY` in `.dev.vars` or switch to stub (`SANDBOX_PROVIDER` unset) |
| Code execution returns simulated output | Using stub sandbox provider | Set `SANDBOX_PROVIDER=e2b` with a valid `E2B_API_KEY` for real execution |
| Skills not appearing in model output | Missing import or `rawSkills` entry | Ensure the SKILL.md is imported and added to the array in `skills/discovery.ts` |
