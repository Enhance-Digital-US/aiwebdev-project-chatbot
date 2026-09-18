# MCP Client Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat backend connects to external MCP servers over Streamable HTTP and exposes their tools to the model alongside local tools, via two swappable client implementations (hand-rolled and `@ai-sdk/mcp`).

**Architecture:** A new `packages/backend/src/mcp/` module defines a per-server `McpToolLoader` seam with two implementations selected by the `MCP_IMPL` env var. An orchestrator connects to all enabled servers in parallel (failures isolated, 5s timeout), namespaces remote tools as `${serverName}_${toolName}`, and merges them into the existing local `ToolSet` in the chat route. The frontend gains one branch to render `dynamic-tool` message parts.

**Tech Stack:** Cloudflare Workers, Hono, AI SDK v7 (`ai`, `@ai-sdk/mcp`), Zod, React + ai-elements.

**Spec:** `docs/superpowers/specs/2026-09-18-mcp-client-design.md`

## Global Constraints

- **No automated tests this phase** (user decision in spec). Each task verifies via `tsc --noEmit` / build plus manual checks; do NOT add test files or test frameworks.
- Streamable HTTP transport only; stdio is impossible on Workers.
- Raw loader scope: `initialize` handshake, `notifications/initialized`, `Mcp-Session-Id` echo, `tools/list`, `tools/call` only. No resources, prompts, sampling, elicitation, OAuth, or server-initiated notifications.
- A broken MCP server must never break the chat: per-server failures are logged and skipped; all-servers-down degrades to local-tools-only.
- Remote tool names are always namespaced `${server.name}_${toolName}` (underscore separator).
- Demo servers (public, read-only, no auth): `cf-docs` → `https://docs.mcp.cloudflare.com/mcp`, `deepwiki` → `https://mcp.deepwiki.com/mcp`.
- Backend typecheck command: `pnpm --filter backend exec tsc --noEmit`. Frontend build: `pnpm --filter frontend build`.
- Commit after every task with a conventional-commit message ending in the attribution line used by earlier commits in this repo.

---

### Task 1: MCP module scaffolding — types, config, env plumbing

**Files:**
- Create: `packages/backend/src/mcp/types.ts`
- Create: `packages/backend/src/mcp/config.ts`
- Modify: `packages/backend/src/types.ts` (add `MCP_IMPL` binding)
- Modify: `packages/backend/wrangler.toml` (add `[vars]` section)

**Interfaces:**
- Consumes: `ToolSet` from `ai` (already a backend dependency).
- Produces: `McpServerConfig`, `McpConnection`, `McpToolLoader` types and the `mcpServers` config array. Tasks 2–4 import these exact names from `./types` and `./config`.

- [ ] **Step 1: Create `packages/backend/src/mcp/types.ts`**

```ts
import type { ToolSet } from "ai";

export interface McpServerConfig {
  /** Short slug; becomes the tool-name prefix, e.g. "cf-docs" → "cf-docs_search_docs" */
  name: string;
  /** Streamable HTTP endpoint */
  url: string;
  enabled: boolean;
  /** For future authenticated servers; values should come from Worker secrets */
  headers?: Record<string, string>;
}

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

/** Connects to ONE server and returns its (un-namespaced) tools. */
export type McpToolLoader = (server: McpServerConfig) => Promise<McpConnection>;
```

- [ ] **Step 2: Create `packages/backend/src/mcp/config.ts`**

```ts
import type { McpServerConfig } from "./types";

export const mcpServers: McpServerConfig[] = [
  {
    name: "cf-docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    enabled: true,
  },
  {
    name: "deepwiki",
    url: "https://mcp.deepwiki.com/mcp",
    enabled: true,
  },
];
```

- [ ] **Step 3: Add the `MCP_IMPL` binding to `packages/backend/src/types.ts`**

Change the `Bindings` type to:

```ts
export type AppEnv = {
  Bindings: {
    OPENAI_API_KEY: string;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    /** MCP client implementation: "ai-sdk" (default) or "raw" */
    MCP_IMPL?: "ai-sdk" | "raw";
  };
};
```

- [ ] **Step 4: Add the var to `packages/backend/wrangler.toml`**

Append:

```toml
[vars]
MCP_IMPL = "ai-sdk"
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/mcp/types.ts packages/backend/src/mcp/config.ts packages/backend/src/types.ts packages/backend/wrangler.toml
git commit -m "feat: add MCP module types, static server config, and MCP_IMPL env plumbing"
```

---

### Task 2: AI SDK loader

**Files:**
- Create: `packages/backend/src/mcp/ai-sdk-loader.ts`
- Modify: `packages/backend/package.json` (via `pnpm add`)

**Interfaces:**
- Consumes: `McpToolLoader`, `McpServerConfig`, `McpConnection` from `./types` (Task 1).
- Produces: `aiSdkLoader: McpToolLoader`. Task 4 imports this exact name.

- [ ] **Step 1: Install the dependency**

Run: `pnpm --filter backend add @ai-sdk/mcp`
Expected: installs without peer-dependency errors against `ai@^7`.

- [ ] **Step 2: Create `packages/backend/src/mcp/ai-sdk-loader.ts`**

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import type { McpToolLoader } from "./types";

export const aiSdkLoader: McpToolLoader = async (server) => {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: server.url,
      ...(server.headers && { headers: server.headers }),
    },
  });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
};
```

Note: if `tsc` reports that the export is named differently in the installed
version (e.g. `experimental_createMCPClient` re-exported from `ai`), check
`node_modules/@ai-sdk/mcp/dist/index.d.ts` for the actual export name and use
that — do not guess.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/package.json pnpm-lock.yaml packages/backend/src/mcp/ai-sdk-loader.ts
git commit -m "feat: add @ai-sdk/mcp loader implementation"
```

---

### Task 3: Raw protocol loader

**Files:**
- Create: `packages/backend/src/mcp/raw-loader.ts`

**Interfaces:**
- Consumes: `McpToolLoader`, `McpServerConfig` from `./types` (Task 1); `jsonSchema`, `tool` from `ai`.
- Produces: `rawLoader: McpToolLoader`. Task 4 imports this exact name.

- [ ] **Step 1: Create `packages/backend/src/mcp/raw-loader.ts`**

This is the educational implementation: it makes the Streamable HTTP mechanics
visible that `@ai-sdk/mcp` hides — the `initialize` handshake, the
`notifications/initialized` follow-up, `Mcp-Session-Id` capture/echo, and the
fact that a server may answer a POST with either `application/json` or a
`text/event-stream` body.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";
import type { McpServerConfig, McpToolLoader } from "./types";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpContentBlock {
  type: string;
  text?: string;
}

/**
 * Streamable HTTP allows a server to answer a POST with plain JSON or with an
 * SSE stream containing the JSON-RPC response. Handle both; a 202 with no body
 * is the ack for notifications.
 */
async function parseJsonRpcResponse(
  res: Response
): Promise<JsonRpcMessage | null> {
  if (res.status === 202) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data) continue;
      const message = JSON.parse(data) as JsonRpcMessage;
      // Skip server-initiated notifications; the response carries an id.
      if (message.id !== undefined) return message;
    }
    return null;
  }
  return (await res.json()) as JsonRpcMessage;
}

class RawMcpClient {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private readonly server: McpServerConfig) {}

  private async post(body: Record<string, unknown>): Promise<Response> {
    return fetch(this.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(this.sessionId && { "mcp-session-id": this.sessionId }),
        ...this.server.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    if (!res.ok) {
      throw new Error(`${this.server.name}: ${method} → HTTP ${res.status}`);
    }
    // The server may mint a session on initialize; echo it on every
    // subsequent request. This is the part of Streamable HTTP people miss.
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const message = await parseJsonRpcResponse(res);
    if (!message) {
      throw new Error(`${this.server.name}: ${method} → empty response`);
    }
    if (message.error) {
      throw new Error(
        `${this.server.name}: ${method} → JSON-RPC error ${message.error.code}: ${message.error.message}`
      );
    }
    return message.result ?? {};
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "chatbot-backend", version: "0.1.0" },
    });
    // Spec-required notification (no id, no response expected).
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request("tools/list", {});
    return (result.tools ?? []) as McpToolDefinition[];
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const content = (result.content ?? []) as McpContentBlock[];
    if (result.isError) {
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(`${this.server.name}: tool "${name}" failed: ${text}`);
    }
    return content;
  }

  async close(): Promise<void> {
    // Streamable HTTP: DELETE with the session id terminates the session.
    if (!this.sessionId) return;
    await fetch(this.server.url, {
      method: "DELETE",
      headers: {
        "mcp-session-id": this.sessionId,
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...this.server.headers,
      },
    }).catch(() => {
      // Best-effort teardown; some servers don't support DELETE.
    });
  }
}

export const rawLoader: McpToolLoader = async (server) => {
  const client = new RawMcpClient(server);
  await client.initialize();
  const definitions = await client.listTools();

  const tools: ToolSet = {};
  for (const def of definitions) {
    tools[def.name] = tool({
      description: def.description,
      // Pass the server's JSON Schema through untouched instead of
      // reconstructing it with Zod — the model only needs the schema shape.
      inputSchema: jsonSchema(def.inputSchema),
      execute: (args) => client.callTool(def.name, args),
    });
  }

  return { tools, close: () => client.close() };
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter backend exec tsc --noEmit`
Expected: no errors. If `jsonSchema(def.inputSchema)` complains about the
argument type, cast the schema: `jsonSchema(def.inputSchema as Parameters<typeof jsonSchema>[0])`.

- [ ] **Step 3: Smoke-test the handshake against a live server**

Run (from repo root):

```bash
cat > /tmp/mcp-smoke.mjs <<'EOF'
const res = await fetch("https://docs.mcp.cloudflare.com/mcp", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
  }),
});
console.log("status:", res.status, "content-type:", res.headers.get("content-type"), "session:", res.headers.get("mcp-session-id"));
console.log((await res.text()).slice(0, 400));
EOF
node /tmp/mcp-smoke.mjs
```

Expected: HTTP 200 and a JSON-RPC `result` containing `serverInfo` (body may be
JSON or an SSE `data:` line — both are fine and this is exactly what
`parseJsonRpcResponse` handles). If the endpoint requires a different protocol
version, use the version string from its error message in `PROTOCOL_VERSION`.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/mcp/raw-loader.ts
git commit -m "feat: add hand-rolled Streamable HTTP MCP client loader"
```

---

### Task 4: Orchestrator — selection, parallel connect, namespacing, merge

**Files:**
- Create: `packages/backend/src/mcp/index.ts`

**Interfaces:**
- Consumes: `aiSdkLoader` (Task 2), `rawLoader` (Task 3), `mcpServers` (Task 1), `McpConnection`/`McpToolLoader` types (Task 1), `AppEnv` from `../types`.
- Produces: `loadMcpTools(env: AppEnv["Bindings"]): Promise<{ tools: ToolSet; close: () => Promise<void> }>`. Task 5 imports this exact name from `../mcp`.

- [ ] **Step 1: Create `packages/backend/src/mcp/index.ts`**

```ts
import type { ToolSet } from "ai";
import type { AppEnv } from "../types";
import type { McpConnection, McpToolLoader } from "./types";
import { mcpServers } from "./config";
import { aiSdkLoader } from "./ai-sdk-loader";
import { rawLoader } from "./raw-loader";

const CONNECT_TIMEOUT_MS = 5000;

/**
 * Race-based timeout: a hung server must not delay the user's first streamed
 * token. The losing connect attempt is abandoned, not cancelled — acceptable
 * here; request-scoped Workers tear everything down shortly after anyway.
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`${label}: connect timed out after ${CONNECT_TIMEOUT_MS}ms`)
          ),
        CONNECT_TIMEOUT_MS
      )
    ),
  ]);
}

export async function loadMcpTools(
  env: AppEnv["Bindings"]
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const loader: McpToolLoader = env.MCP_IMPL === "raw" ? rawLoader : aiSdkLoader;
  const enabled = mcpServers.filter((server) => server.enabled);

  const results = await Promise.allSettled(
    enabled.map((server) => withTimeout(loader(server), server.name))
  );

  const tools: ToolSet = {};
  const connections: McpConnection[] = [];

  results.forEach((result, i) => {
    const server = enabled[i];
    if (result.status === "rejected") {
      // A broken connector never breaks the chat.
      console.error(`MCP server "${server.name}" unavailable:`, result.reason);
      return;
    }
    connections.push(result.value);
    for (const [name, remoteTool] of Object.entries(result.value.tools)) {
      tools[`${server.name}_${name}`] = remoteTool;
    }
  });

  return {
    tools,
    close: async () => {
      await Promise.allSettled(connections.map((c) => c.close()));
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/mcp/index.ts
git commit -m "feat: add MCP orchestrator with impl selection, timeout, and namespaced merge"
```

---

### Task 5: Chat route wiring + backend verification

**Files:**
- Modify: `packages/backend/src/routes/chat.ts`

**Interfaces:**
- Consumes: `loadMcpTools` from `../mcp` (Task 4); existing `tools`, `getModel`, `flushTelemetry`.
- Produces: the `/chat` endpoint now streams with merged local + MCP tools; no signature changes for the frontend.

- [ ] **Step 1: Rewrite `packages/backend/src/routes/chat.ts`**

Replace the whole file with:

```ts
import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";
import type { AppEnv } from "../types";
import { getModel } from "../providers";
import { tools } from "../tools";
import { loadMcpTools } from "../mcp";
import { flushTelemetry } from "../telemetry";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = "gpt-4o-mini" } = await c.req.json();
  const config = getModel(modelId);
  const supportsTools = config.supportsTools !== false;

  // Skip MCP entirely for models that can't use tools — no latency paid
  // for capabilities the model can't exercise.
  let mcpTools: ToolSet = {};
  let closeMcp = async () => {};
  if (supportsTools) {
    try {
      ({ tools: mcpTools, close: closeMcp } = await loadMcpTools(c.env));
    } catch (error) {
      console.error("MCP tool loading failed, using local tools only:", error);
    }
  }

  const result = streamText({
    model: config.createModel(c.env),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
    providerOptions: config.providerOptions,
    ...(supportsTools && {
      tools: { ...tools, ...mcpTools },
      // MCP research tools chain calls (search → read → answer); the old
      // budget of 2 was sized for one-shot local lookups.
      stopWhen: isStepCount(5),
    }),
    telemetry: { functionId: config.telemetryId },
    onEnd() {
      c.executionCtx.waitUntil(Promise.all([closeMcp(), flushTelemetry()]));
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: config.sendReasoning,
    }),
  });
});

export default chat;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter backend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify the endpoint streams MCP tool calls**

Start the backend: `pnpm --filter backend dev` (leave running; note the port,
default 8787). Then:

```bash
curl -N -s http://localhost:8787/chat \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Search the Cloudflare docs for Durable Object alarms and summarize."}]}]}' \
  | head -c 4000
```

(If the chat route is mounted under a prefix in `src/index.ts` — check it —
adjust the path, e.g. `/api/chat`.)

Expected: the UI-message stream contains a `dynamic-tool` part whose
`toolName` starts with `cf-docs_`, followed by streamed text referencing doc
content. Also check the dev-server logs show no unhandled errors.

- [ ] **Step 4: Verify failure isolation**

Temporarily set `enabled: false` → back to `true` is NOT the test; instead
edit `config.ts` to point `deepwiki`'s `url` at `https://invalid.example/mcp`,
re-run the curl above. Expected: chat still answers via `cf-docs`, and the log
shows `MCP server "deepwiki" unavailable:`. Revert the URL afterwards.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/chat.ts
git commit -m "feat: merge MCP tools into chat route with graceful degradation"
```

---

### Task 6: Frontend dynamic-tool rendering + end-to-end verification

**Files:**
- Modify: `packages/frontend/src/routes/index.tsx:39-74` (ToolInvocation + imports) and `:120-124` (render branch)

**Interfaces:**
- Consumes: `ToolPart` type already exported by `packages/frontend/src/components/ai-elements/tool.tsx:33`; the `dynamic-tool` UI message parts now emitted by the backend (Task 5).
- Produces: MCP tool invocations render in the chat UI with the namespaced tool name as provenance.

- [ ] **Step 1: Generalize `ToolInvocation` and add the render branch in `packages/frontend/src/routes/index.tsx`**

Replace the `ToolUIPart` import (line 39) with:

```tsx
import type { ToolPart } from "@/components/ai-elements/tool";
```

Replace the `ToolInvocation` component with:

```tsx
function ToolInvocation({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (part.state === "output-available" || part.state === "output-error") {
      setOpen(true);
    }
  }, [part.state]);

  return (
    <ToolDisplay open={open} onOpenChange={setOpen}>
      {part.type === "dynamic-tool" ? (
        // Runtime-discovered (MCP) tools share one part type; the namespaced
        // toolName (e.g. "cf-docs_search_docs") doubles as provenance.
        <ToolHeader type={part.type} state={part.state} toolName={part.toolName} />
      ) : (
        <ToolHeader type={part.type} state={part.state} />
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={part.state === "output-available" ? part.output : undefined}
          errorText={part.state === "output-error" ? part.errorText : undefined}
        />
      </ToolContent>
    </ToolDisplay>
  );
}
```

Replace the tool render branch (line 120):

```tsx
if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
  return <ToolInvocation key={i} part={part as ToolPart} />;
}
```

- [ ] **Step 2: Build the frontend**

Run: `pnpm --filter frontend build`
Expected: typecheck + build succeed.

- [ ] **Step 3: End-to-end verification, AI SDK implementation**

Run backend (`pnpm --filter backend dev`) and frontend (`pnpm --filter frontend dev`).
In the browser: ask **"Search the Cloudflare docs for Durable Object alarms."**
Expected: a collapsible tool card titled with a `cf-docs_…` name appears,
opens on completion showing input/output, and the answer cites doc content.
Local tools still work: ask **"convert 5 km to miles"** and confirm the
`convertUnits` card renders as before.

- [ ] **Step 4: End-to-end verification, raw implementation**

Stop the backend; restart with the raw loader:

```bash
cd packages/backend && MCP_IMPL=raw pnpm dev
```

(If wrangler ignores the shell var because `[vars]` wins, temporarily change
`MCP_IMPL = "raw"` in `wrangler.toml` instead, and revert after.)
Repeat the docs question. Expected: identical behavior — same namespaced tool
card, same answer quality. This is the payoff moment: both implementations are
indistinguishable through the seam.

- [ ] **Step 5: Verify the no-tools model path**

If a local Ollama with `gemma4:12b` is available: select "Gemma 4 12B" in the
UI, send any message, and confirm the reply streams with no MCP connection
attempts in the backend log. If Ollama is not running, verify by code
inspection that `supportsTools === false` short-circuits before
`loadMcpTools` (it does — Task 5 Step 1) and note it in the task report.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/routes/index.tsx
git commit -m "feat: render dynamic-tool (MCP) invocations in chat UI"
```
