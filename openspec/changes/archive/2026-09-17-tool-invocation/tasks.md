# Tool Invocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a tool invocation system so the AI model can call custom backend functions during a conversation, with results rendered in the chat UI.

**Architecture:** Tool registry pattern — each tool is a separate file exporting an AI SDK `tool()` definition with Zod schemas. A registry module collects them into a `ToolSet` passed conditionally to `streamText` based on model capabilities. The frontend uses the ai-elements `Tool` component for rendering.

**Tech Stack:** AI SDK v7 (`ai`, `@ai-sdk/react`), Zod, Hono, ai-elements components, Cloudflare Workers

**Spec:** `docs/superpowers/specs/2026-09-17-tool-invocation-design.md`

## Global Constraints

- AI SDK v7 (`ai@^7.0.32`, `@ai-sdk/react@^4.0.35`) — use `tool()`, `inputSchema` (not `parameters`), `streamText`, `toUIMessageStream`
- Two-step tool execution: `stopWhen: isStepCount(2)` — step 1 is the tool call, step 2 is the text response using tool results. The default `isStepCount(1)` would stop after the tool call without generating a follow-up text response.
- No `eval` or `new Function()` — Cloudflare Workers V8 isolates disallow runtime code generation
- All tools are server-side with `execute` functions — no client-side tools
- Backend runs on Cloudflare Workers (`wrangler`) — no Node.js APIs (`fs`, `child_process`, etc.)
- pnpm monorepo — use `pnpm add` for dependencies, run from the relevant package directory
- ai-elements components are installed via `pnpm dlx ai-elements@latest add <component>` from the frontend package directory

---

### Task 1: Add Zod dependency and create the weather tool

**Files:**
- Modify: `packages/backend/package.json` — add `zod` dependency
- Create: `packages/backend/src/tools/weather.ts` — weather tool definition

**Interfaces:**
- Consumes: nothing
- Produces: `getWeather` — a named export of type `ReturnType<typeof tool>` with `inputSchema: z.object({ city: z.string() })` and `execute: ({ city }) => Promise<{ temperature: number; condition: string; city: string }>`

- [x] **Step 1: Install zod in the backend package**

Run from the repo root:

```bash
cd packages/backend && pnpm add zod
```

- [x] **Step 2: Create the weather tool**

Create file `packages/backend/src/tools/weather.ts`:

```ts
import { tool } from "ai";
import { z } from "zod";

export const getWeather = tool({
  description: "Get current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
  execute: async ({ city }) => {
    const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temperature = Math.floor(Math.random() * 35) + 5;
    return { temperature, condition, city };
  },
});
```

- [x] **Step 3: Verify the file compiles**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add packages/backend/package.json pnpm-lock.yaml packages/backend/src/tools/weather.ts
git commit -m "$(cat <<'EOF'
feat: add weather tool with zod schema

First tool in the registry — returns random weather data for a given city
using AI SDK v7's tool() helper with Zod inputSchema.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create the unit converter tool and tool registry

**Files:**
- Create: `packages/backend/src/tools/convert-units.ts` — unit conversion tool definition
- Create: `packages/backend/src/tools/index.ts` — registry collecting all tools

**Interfaces:**
- Consumes: `getWeather` from `./weather`
- Produces:
  - `convertUnits` — a named export of type `ReturnType<typeof tool>` with `inputSchema: z.object({ value: z.number(), from: z.string(), to: z.string() })` and `execute: ({ value, from, to }) => Promise<{ value: number; from: string; to: string; result: number | string }>`
  - `tools` — a `ToolSet` object containing `{ getWeather, convertUnits }`

- [x] **Step 1: Create the unit converter tool**

Create file `packages/backend/src/tools/convert-units.ts`:

```ts
import { tool } from "ai";
import { z } from "zod";

const conversions: Record<string, Record<string, (v: number) => number>> = {
  km: { miles: (v) => v * 0.621371, meters: (v) => v * 1000 },
  miles: { km: (v) => v * 1.60934, meters: (v) => v * 1609.34 },
  meters: { km: (v) => v / 1000, miles: (v) => v / 1609.34, feet: (v) => v * 3.28084 },
  feet: { meters: (v) => v / 3.28084, km: (v) => v / 3280.84 },
  celsius: { fahrenheit: (v) => v * 9 / 5 + 32, kelvin: (v) => v + 273.15 },
  fahrenheit: { celsius: (v) => (v - 32) * 5 / 9, kelvin: (v) => (v - 32) * 5 / 9 + 273.15 },
  kelvin: { celsius: (v) => v - 273.15, fahrenheit: (v) => (v - 273.15) * 9 / 5 + 32 },
  kg: { lbs: (v) => v * 2.20462, grams: (v) => v * 1000 },
  lbs: { kg: (v) => v / 2.20462, grams: (v) => v * 453.592 },
  grams: { kg: (v) => v / 1000, lbs: (v) => v / 453.592 },
};

export const convertUnits = tool({
  description: "Convert a value from one unit to another (length, temperature, weight)",
  inputSchema: z.object({
    value: z.number().describe("The numeric value to convert"),
    from: z.string().describe("The source unit (e.g. 'celsius', 'km', 'kg')"),
    to: z.string().describe("The target unit (e.g. 'fahrenheit', 'miles', 'lbs')"),
  }),
  execute: async ({ value, from, to }) => {
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    const converter = conversions[fromLower]?.[toLower];
    if (!converter) {
      return { value, from, to, result: `Error: cannot convert from ${from} to ${to}` };
    }
    const result = Math.round(converter(value) * 1000) / 1000;
    return { value, from, to, result };
  },
});
```

- [x] **Step 2: Create the tool registry**

Create file `packages/backend/src/tools/index.ts`:

```ts
import type { ToolSet } from "ai";
import { getWeather } from "./weather";
import { convertUnits } from "./convert-units";

export const tools = {
  getWeather,
  convertUnits,
} satisfies ToolSet;
```

- [x] **Step 3: Verify compilation**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add packages/backend/src/tools/convert-units.ts packages/backend/src/tools/index.ts
git commit -m "$(cat <<'EOF'
feat: add unit converter tool and tool registry

Creates the tool registry pattern — each tool is a separate file, the
index collects them into a single ToolSet for streamText. Unit converter
replaces calculator since new Function() is unavailable on CF Workers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire tools into the chat route with model-aware opt-out

**Files:**
- Modify: `packages/backend/src/providers.ts:6-11` — add `supportsTools` to `ModelConfig`
- Modify: `packages/backend/src/routes/chat.ts:14-27` — import tools, pass conditionally to `streamText`

**Interfaces:**
- Consumes: `tools` from `../tools` (the `ToolSet` object)
- Produces: the `/api/chat` endpoint now passes tools to `streamText` when `config.supportsTools !== false`, streaming tool-call parts alongside text/reasoning parts

- [x] **Step 1: Add `supportsTools` to `ModelConfig`**

In `packages/backend/src/providers.ts`, add the `supportsTools` field to the `ModelConfig` type. Both models default to `true` (tools enabled). The flag exists so individual models can opt out later if needed.

The `ModelConfig` type at line 6 currently reads:

```ts
export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  telemetryId: string;
};
```

Change it to:

```ts
export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  supportsTools?: boolean;
  telemetryId: string;
};
```

Do **not** set `supportsTools: false` on any model — the user specified all models should attempt tool calling. Leave both `gpt-4o-mini` and `gemma4:12b` defaulting to `true`.

- [x] **Step 2: Wire tools into the chat route**

In `packages/backend/src/routes/chat.ts`, add the tools import and pass them conditionally.

The current imports (lines 1-7) are:

```ts
import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
```

Add `isStepCount` to the `ai` import and add the tools import after:

```ts
import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { AppEnv } from "../types";
import { getModel } from "../providers";
import { tools } from "../tools";
import { flushTelemetry } from "../telemetry";
```

The current `streamText` call (lines 18-27) is:

```ts
const result = streamText({
    model: config.createModel(c.env),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
    providerOptions: config.providerOptions,
    telemetry: { functionId: config.telemetryId },
    onEnd() {
      c.executionCtx.waitUntil(flushTelemetry());
    },
  });
```

Change it to:

```ts
const result = streamText({
    model: config.createModel(c.env),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
    providerOptions: config.providerOptions,
    ...(config.supportsTools !== false && { tools, stopWhen: isStepCount(2) }),
    telemetry: { functionId: config.telemetryId },
    onEnd() {
      c.executionCtx.waitUntil(flushTelemetry());
    },
  });
```

The `stopWhen: isStepCount(2)` allows two steps: step 1 is the tool call, step 2 is the text response that uses the tool results. Without this, the default `isStepCount(1)` stops after the tool call and the model never generates a follow-up text answer.

- [x] **Step 3: Verify compilation**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add packages/backend/src/providers.ts packages/backend/src/routes/chat.ts
git commit -m "$(cat <<'EOF'
feat: wire tool registry into chat route

Tools are passed conditionally to streamText based on ModelConfig's
supportsTools flag (defaults to true for all models). Uses
stopWhen: isStepCount(2) so the model generates a text response
after calling tools.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Install the ai-elements Tool component and render tool parts in the frontend

**Files:**
- Install: `packages/frontend/src/components/ai-elements/tool.tsx` (via ai-elements CLI)
- Modify: `packages/frontend/src/routes/index.tsx:1-10,70-95` — add Tool imports and render tool parts

**Interfaces:**
- Consumes: `Tool`, `ToolContent`, `ToolHeader`, `ToolInput`, `ToolOutput` from `@/components/ai-elements/tool`
- Produces: the chat UI now renders tool invocation parts with collapsible display, status badges, and formatted I/O

- [x] **Step 1: Install the ai-elements Tool component**

Run from the frontend package directory:

```bash
cd packages/frontend && pnpm dlx ai-elements@latest add tool
```

This will create `src/components/ai-elements/tool.tsx` and install any missing UI dependencies (like `badge`).

- [x] **Step 2: Verify the component was installed**

```bash
ls packages/frontend/src/components/ai-elements/tool.tsx
```

Expected: file exists. If the CLI also created `components/ui/badge.tsx`, that's expected — the Tool component depends on it.

- [x] **Step 3: Add tool rendering to the chat page**

In `packages/frontend/src/routes/index.tsx`, add the Tool imports. The current imports (lines 1-39) include components from `message`, `reasoning`, `prompt-input`, and `model-selector`. After the model-selector imports (around line 39), add:

```tsx
import type { ToolUIPart } from "ai";
import {
  Tool as ToolDisplay,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
```

Note: `Tool` is imported as `ToolDisplay` to avoid collision with any `Tool` type from `ai`.

Then modify the message parts rendering. The current code (lines 73-91) is:

```tsx
{message.parts.map((part, i) => {
                  if (part.type === "reasoning") {
                    return (
                      <Reasoning
                        key={i}
                        isStreaming={part.state === "streaming"}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  }
                  if (part.type === "text") {
                    return (
                      <MessageResponse key={i}>{part.text}</MessageResponse>
                    );
                  }
                  return null;
                })}
```

Replace it with:

```tsx
{message.parts.map((part, i) => {
                  if (part.type === "reasoning") {
                    return (
                      <Reasoning
                        key={i}
                        isStreaming={part.state === "streaming"}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  }
                  if (part.type === "text") {
                    return (
                      <MessageResponse key={i}>{part.text}</MessageResponse>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const toolPart = part as ToolUIPart;
                    return (
                      <ToolDisplay
                        key={i}
                        defaultOpen={
                          toolPart.state === "output-available" ||
                          toolPart.state === "output-error"
                        }
                      >
                        <ToolHeader type={toolPart.type} state={toolPart.state} />
                        <ToolContent>
                          <ToolInput input={toolPart.input} />
                          <ToolOutput
                            output={
                              toolPart.state === "output-available" ? (
                                <MessageResponse>
                                  {typeof toolPart.output === "string"
                                    ? toolPart.output
                                    : JSON.stringify(toolPart.output, null, 2)}
                                </MessageResponse>
                              ) : undefined
                            }
                            errorText={
                              toolPart.state === "output-error"
                                ? toolPart.errorText
                                : undefined
                            }
                          />
                        </ToolContent>
                      </ToolDisplay>
                    );
                  }
                  return null;
                })}
```

The cast `as ToolUIPart` is necessary because `String.prototype.startsWith` doesn't narrow TypeScript unions. `ToolUIPart` is the AI SDK's generic type for all tool parts — it provides typed access to `.input`, `.output`, `.state`, and `.errorText`. If `ToolUIPart` isn't directly exported from `ai`, check the ai-elements `tool.tsx` source — it imports `ToolPart` which is equivalent.

- [x] **Step 4: Verify compilation**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors. If `ToolUIPart` is not exported from `ai`, grep for the correct type name:

```bash
grep -r "ToolUIPart\|ToolPart\|DynamicToolUIPart" packages/frontend/src/components/ai-elements/tool.tsx
```

Use whatever type name the tool component imports.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/components/ai-elements/tool.tsx packages/frontend/src/components/ui/badge.tsx packages/frontend/src/routes/index.tsx
git commit -m "$(cat <<'EOF'
feat: render tool invocations in chat UI

Installs the ai-elements Tool component and renders tool-call parts
in the conversation with collapsible display, status badges, and
formatted input/output.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Note: only include `badge.tsx` in the git add if the ai-elements CLI created it. Run `git status` first to check.

---

### Task 5: End-to-end verification

**Files:** none (manual testing)

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: verified working tool invocation

- [x] **Step 1: Start the backend dev server**

```bash
cd packages/backend && pnpm dev
```

Expected: Wrangler starts the worker on `http://localhost:8787` (or the configured port).

- [x] **Step 2: Start the frontend dev server**

In a second terminal:

```bash
cd packages/frontend && pnpm dev
```

Expected: Vite starts on `http://localhost:5173`.

- [x] **Step 3: Test tool invocation with OpenAI**

Open `http://localhost:5173` in a browser. Select the GPT-4o Mini model. Send a message like:

> "What's the weather in Tokyo?"

Expected:
- The model makes a `getWeather` tool call
- A collapsible Tool component appears in the chat showing:
  - Header with tool name and "Completed" status badge
  - Input section showing `{ "city": "Tokyo" }`
  - Output section showing the weather result JSON
- The model then responds with a text message incorporating the weather data

- [x] **Step 4: Test unit conversion tool**

Send a message like:

> "Convert 100 kilometers to miles"

Expected:
- The model calls the `convertUnits` tool with `{ value: 100, from: "km", to: "miles" }`
- Tool display shows the conversion input and result (62.137)
- Model responds with the answer in natural language

- [x] **Step 5: Test Ollama model with tools**

Switch to the Gemma 4 12B model (requires Ollama running locally). Send a message like "What's the weather in Paris?"

Expected:
- The model attempts tool calling — it may succeed or fail depending on the model's tool-calling capability
- If it succeeds: tool display and text response appear as with OpenAI
- If it fails gracefully: the model responds with text only (no crash, no console errors)
- The key verification is that the app doesn't error — graceful degradation is acceptable

- [x] **Step 6: Test unsupported conversion**

Send a message like:

> "Convert 50 liters to gallons"

Expected:
- The model calls `convertUnits` with an unsupported unit pair
- The tool returns an error string: "Error: cannot convert from liters to gallons"
- The model reports the limitation in its text response
- The Tool component displays cleanly without crashing
