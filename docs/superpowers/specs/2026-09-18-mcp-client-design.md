# MCP Client Support — Design

**Date:** 2026-09-18
**Status:** Approved design, pending implementation plan
**Sub-project:** 1 of 6 (roadmap: MCP → Skills → Secure code execution → Durable execution → Guardrails → Evals)

## Context

The chatbot (Hono on Cloudflare Workers, AI SDK v7, React/Vite frontend) has a
static local tool registry (`packages/backend/src/tools/`) whose tools
auto-execute during streaming chat. This phase adds **MCP client support**: the
backend connects to external MCP servers and exposes their tools to the model
alongside local tools.

This is a learning project. Two client implementations are built behind one
shared interface to contrast the raw protocol with the AI SDK's abstraction.

## Decisions (from brainstorming)

- **Client only** — the app consumes external MCP servers; no MCP server is built.
- **Static backend config** — server list lives in code; no settings UI, no persistence.
- **Auto-execute** — MCP tools run without a user-approval step (demo servers are
  public and read-only). Human-in-the-loop arrives with Guardrails (phase 5).
- **Both implementations** — a hand-rolled minimal client (B) *and* the AI SDK
  client (A), swappable via env var, to highlight what the SDK abstracts away.
- **No automated tests this phase** — manual verification only (user decision).

## Architecture

New backend module `packages/backend/src/mcp/`:

```
mcp/
  config.ts        # static server list
  types.ts         # shared McpToolLoader interface
  ai-sdk-loader.ts # implementation A (@ai-sdk/mcp)
  raw-loader.ts    # implementation B (hand-rolled Streamable HTTP client)
  index.ts         # picks implementation via env, applies namespacing, merges
```

### Configuration (`config.ts`)

```ts
interface McpServerConfig {
  name: string;              // short slug, used as tool-name prefix
  url: string;               // Streamable HTTP endpoint
  enabled: boolean;
  headers?: Record<string, string>; // for future authenticated servers (values from Worker secrets)
}
```

Demo entries (public, unauthenticated, read-only):

- `cf-docs` → `https://docs.mcp.cloudflare.com/mcp` (Cloudflare Docs MCP)
- `deepwiki` → `https://mcp.deepwiki.com/mcp` (DeepWiki)

### Shared seam (`types.ts`)

```ts
type McpToolLoader = (servers: McpServerConfig[]) =>
  Promise<{ tools: ToolSet; close: () => Promise<void> }>;
```

Both loaders satisfy this signature. `chat.ts` never knows which is active.

### Implementation A (`ai-sdk-loader.ts`)

Uses `createMCPClient` from `@ai-sdk/mcp` with the inline HTTP transport config
(`{ type: "http", url, headers }`). One client per enabled server;
`client.tools()` yields the ToolSet; `close()` closes all clients.

### Implementation B (`raw-loader.ts`)

Minimal hand-rolled Streamable HTTP client, ~200 lines. In scope:

- `initialize` request/response handshake + `notifications/initialized`
- `Mcp-Session-Id` response-header capture and echo on all subsequent requests
- `tools/list` → convert each advertised tool to an AI SDK tool using
  `jsonSchema()` pass-through of the server's input schema
- `tools/call` inside each tool's `execute`
- Responses may arrive as `application/json` or a `text/event-stream` body;
  support both (for SSE, parse the response's data events for the JSON-RPC result)

Out of scope: stdio transport (impossible on Workers), server-initiated
notifications, resources, prompts, sampling, elicitation, OAuth.

### Selection & merging (`index.ts`)

- Env var `MCP_IMPL`: `"ai-sdk"` (default) or `"raw"`.
- Connect to all enabled servers **in parallel** with `Promise.allSettled`.
- Namespace every remote tool as `${serverName}_${toolName}`
  (e.g. `cf-docs_search_docs`) before merging, so remote tools can never
  collide with local tools or each other.
- Exports `loadMcpTools(env): Promise<{ tools, close }>`.

## Chat route changes (`routes/chat.ts`)

```ts
const { tools: mcpTools, close } = await loadMcpTools(c.env);

const result = streamText({
  // ...
  ...(config.supportsTools !== false && {
    tools: { ...tools, ...mcpTools },
    stopWhen: isStepCount(5),        // raised from 2: MCP research tools chain calls
  }),
  onEnd() {
    c.executionCtx.waitUntil(Promise.all([close(), flushTelemetry()]));
  },
});
```

- MCP loading is **skipped entirely** when the selected model has
  `supportsTools === false` (no latency paid for unusable tools).
- `close()` runs via `waitUntil` so teardown never delays the stream.

## Error handling

Principle: **a broken connector never breaks the chat.**

- Per-server connect/list failures are isolated (`Promise.allSettled`), logged
  (visible in `wrangler tail` / OTel traces), and skipped. All-servers-down
  degrades to today's local-tools-only behavior.
- Per-server connect + `tools/list` timeout: `AbortSignal.timeout(5000)`.
- Mid-conversation `tools/call` failures throw descriptive errors from
  `execute`; the AI SDK surfaces them to the model as tool-error results so it
  can recover in-conversation. The raw loader matches this behavior.
- `close()` is best-effort: errors logged and swallowed.

## Frontend

`ai-elements/tool.tsx` already supports `DynamicToolUIPart`. MCP tools stream
as `type: "dynamic-tool"` parts (runtime-discovered, untyped), which the
message renderer in `routes/index.tsx` currently drops — it only matches
`part.type.startsWith("tool-")`.

Change: add a `part.type === "dynamic-tool"` branch reusing the existing
`ToolInvocation` component (~5–10 lines). The namespaced tool name doubles as
provenance (which server ran) in the UI.

## Verification (manual)

1. `wrangler dev`; ask "search the Cloudflare docs for Durable Object alarms".
   Confirm a namespaced dynamic tool invocation renders and the answer uses doc
   content.
2. Set `MCP_IMPL=raw`; repeat and confirm identical behavior.
3. Disable one server in config / point it at a dead URL; confirm chat still
   works with remaining tools and the failure is logged.
4. Select an Ollama reasoning model (`supportsTools === false`); confirm no MCP
   connections are attempted and chat works.

## Out of scope (deferred to later phases)

- Persistent MCP connections, OAuth, connection reuse → phase 4 (Durable execution)
- User-managed server list / settings UI → later, with persistence
- Tool-call approval UI → phase 5 (Guardrails)
- Automated tests → deferred at user's request
