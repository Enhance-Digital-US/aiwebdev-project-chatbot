# Chatbot API Backend

Hono + Cloudflare Workers backend with AI SDK v7. The sections below cover what this checkpoint of the course chatbot includes.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Langfuse account](https://cloud.langfuse.com) (US region)
- (Optional) [Ollama](https://ollama.com) on `:11434` — for the `gemma4:12b` model
- (Optional) [E2B API key](https://e2b.dev) — for sandboxed code execution

## Local Development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example file to `packages/backend/.dev.vars` (gitignored) and fill in your keys:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars.example` lists every variable the backend reads, with comments. At minimum set `OPENAI_API_KEY`, `AI_GATEWAY_TOKEN`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`.

Every OpenAI call goes through **Cloudflare AI Gateway**. The account id and gateway name are `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_NAME` in `wrangler.jsonc` `vars` (override them in `.dev.vars` to use your own gateway). The gateway is authenticated: create a token under **AI Gateway → your gateway → Settings → Authentication** and set it as `AI_GATEWAY_TOKEN`.

Get your Langfuse keys from: **Langfuse Dashboard → Settings → API Keys**

### 3. Start the dev server

```bash
pnpm --filter backend dev
```

The API runs at `http://localhost:8788`.

### 4. Test

```bash
curl -X POST http://localhost:8788/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

After a successful request, check your [Langfuse dashboard](https://us.cloud.langfuse.com) — you should see a trace with:
- Model: `gpt-6-luna`
- Non-zero input/output token counts
- Prompt and completion content

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/chat` | POST | Accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream |

The `model` field defaults to `gpt-6-luna` (`DEFAULT_MODEL`). Available models are registered in `providers.ts`:

| Model ID | Provider | Notes |
|----------|----------|-------|
| `gpt-6-luna` | OpenAI | Default, supports tools; reasoning model (default effort, reasoning not streamed); via AI Gateway |
| `gemma4:12b` | Ollama (local) | Reasoning enabled, requires Ollama running |

## MCP — Remote Tool Federation

The chatbot connects to external [Model Context Protocol](https://modelcontextprotocol.io/) servers and exposes their tools alongside local tools. This lets the model call remote APIs (search docs, query knowledge bases) without custom tool implementations.

### Architecture

Two interchangeable MCP client implementations behind a common `McpToolLoader` interface:

| Implementation | File | Description |
|---------------|------|-------------|
| **Raw** (default) | `mcp/raw-loader.ts` | Hand-rolled Streamable HTTP client. Handles both plain JSON and SSE JSON-RPC responses, and MRTR confirmations. |
| **AI SDK** | `mcp/ai-sdk-loader.ts` | Uses `@ai-sdk/mcp` `createMCPClient` |

Selected via the `MCP_IMPL` env var (default: `"raw"`).

### Configured Servers

Defined in `mcp/config.ts`:

| Server | URL | Purpose |
|--------|-----|---------|
| `cf-docs` | `https://docs.mcp.cloudflare.com/mcp` | Cloudflare documentation search |
| `deepwiki` | `https://mcp.deepwiki.com/mcp` | Open-source project knowledge base |
| `issue-tracker` | `ISSUE_TRACKER_URL` (`http://localhost:8787/mcp` under `pnpm dev`) | The course's issue tracker (projects, issues) |

Remote tools are namespaced as `${serverName}_${toolName}` to prevent collisions with local tools.

### Connection Handling

- All servers connect in parallel with a **5-second timeout** per server
- Failed connections log a warning and are skipped — the chatbot continues with available tools
- Sessions are cleaned up via `DELETE` in the `onEnd` callback (deferred with `waitUntil`)

### The Issue Tracker (local)

The `issue-tracker` server is the course's own MCP server (the `mcp-server` repo). It must run on port **8787**, because it rejects any other Host. That's why this backend runs on 8788.

1. In the `mcp-server` repo, follow its README to set up the local database, then run `pnpm dev`.
2. Here, run `pnpm dev` from the root. It passes `--var ENVIRONMENT:development` (turns on dev tokens) and `--var ISSUE_TRACKER_URL:http://localhost:8787/mcp`.
3. Ask the chat to *"list the open issues in the demo project"*. It calls `issue-tracker_search_issues` on `proj-demo`.

There are no real accounts. Each call carries a development token minted for a **persona**:

| Persona | Role | Can |
|---------|------|-----|
| `user-alice` | admin | everything, including `delete_project` |
| `user-bob` (default) | member | read, create and update issues |
| `user-carol` | viewer | read only |

To switch persona, set `ISSUE_TRACKER_PERSONA` in `.dev.vars` and restart, or for one session run `npx wrangler dev --var ENVIRONMENT:development --var ISSUE_TRACKER_PERSONA:user-alice`. The tracker's `/auth/dev-token` endpoint exists only in development, so this checkpoint's issue-tracker tools work locally only.

**Confirmations (MRTR elicitation).** Some tools ask before acting. As Alice, *"delete the project <id>"* shows a confirmation card with the tracker's message:
- **Approve** retries the call with the answer, and the project is deleted.
- **Cancel** leaves the project, and the model is told it was cancelled.

Only the raw client (`MCP_IMPL=raw`) supports this. To restore the demo data afterwards, run `pnpm db:reset:local` in `mcp-server`.

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
│   └── skills/
│       ├── discovery.ts   # Skill parsing, catalog, prompt builder
│       ├── load-skill.ts  # loadSkill tool definition
│       ├── eli5-explainer/SKILL.md
│       └── senior-architect/SKILL.md
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
| `OPENAI_API_KEY` | Yes | — | OpenAI model |
| `AI_GATEWAY_ACCOUNT_ID` | Yes | `wrangler.jsonc` vars | Cloudflare account that owns the AI Gateway |
| `AI_GATEWAY_NAME` | Yes | `wrangler.jsonc` vars | AI Gateway that OpenAI calls go through |
| `AI_GATEWAY_TOKEN` | Yes | — | Gateway auth token (`cf-aig-authorization`), a secret |
| `LANGFUSE_PUBLIC_KEY` | Yes | — | Langfuse telemetry |
| `LANGFUSE_SECRET_KEY` | Yes | — | Langfuse telemetry |
| `MCP_IMPL` | No | `raw` | MCP client implementation: `"raw"` or `"ai-sdk"` |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama URL for the gemma4 model |
| `SANDBOX_PROVIDER` | No | stub | Code execution sandbox: `"e2b"`, `"cloudflare"`, or omit for stub |
| `E2B_API_KEY` | No | — | Required when `SANDBOX_PROVIDER=e2b` |

## Disabling Prompt/Completion Logging

By default, prompts and completions are sent to Langfuse. To disable per-call:

```typescript
streamText({
  model: openai("gpt-6-luna"),
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
| `E2B_API_KEY is not set` | Using E2B sandbox without API key | Set `E2B_API_KEY` in `.dev.vars` or switch to stub (`SANDBOX_PROVIDER` unset) |
| Code execution returns simulated output | Using stub sandbox provider | Set `SANDBOX_PROVIDER=e2b` with a valid `E2B_API_KEY` for real execution |
| Skills not appearing in model output | Missing import or `rawSkills` entry | Ensure the SKILL.md is imported and added to the array in `skills/discovery.ts` |
