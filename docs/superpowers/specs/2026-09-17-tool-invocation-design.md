# Tool Invocation Design

## Overview

Add a tool invocation system to the chatbot that lets the AI model call custom backend functions during a conversation. Tools are server-side, single-step (one round of tool calls per request), and model-aware (individual models can opt out of tool calling).

This is the first of four planned subsystems (tools → guardrails → sandbox → structured output). The tool registry established here becomes the foundation the others build on.

## Architecture

### Tool Registry (`packages/backend/src/tools/`)

Each tool is a separate file exporting a named AI SDK `tool()` definition. A registry module collects them into a single `ToolSet`.

```
packages/backend/src/tools/
  index.ts          — collects all tools, exports ToolSet + shared types
  weather.ts        — example: get weather for a city
  calculator.ts     — example: evaluate a math expression
```

#### Tool file contract

Each tool file exports a single named tool using AI SDK v7's `tool()` helper with a Zod `inputSchema`:

```ts
// tools/weather.ts
import { tool } from "ai";
import { z } from "zod";

export const getWeather = tool({
  description: "Get current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name"),
  }),
  execute: async ({ city }) => {
    // Implementation here
    return { temperature: 22, condition: "sunny", city };
  },
});
```

#### Registry (`tools/index.ts`)

Collects tools and exports typed helpers for the frontend:

```ts
import type { InferUITools, ToolSet, UIDataTypes, UIMessage } from "ai";
import { getWeather } from "./weather";
import { calculate } from "./calculator";

export const tools = {
  getWeather,
  calculate,
} satisfies ToolSet;

export type ChatTools = InferUITools<typeof tools>;
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;
```

### Model-Aware Tool Passing

`ModelConfig` in `providers.ts` gains a `supportsTools` field:

```ts
export type ModelConfig = {
  createModel: (env: AppEnv["Bindings"]) => LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
  sendReasoning?: boolean;
  supportsTools?: boolean; // defaults to true
  telemetryId: string;
};
```

Models that are unreliable at tool calling (e.g., small Ollama models) set `supportsTools: false`. The chat route conditionally includes tools:

```ts
const result = streamText({
  model: config.createModel(c.env),
  system: "You are a helpful assistant.",
  messages: await convertToModelMessages(messages),
  providerOptions: config.providerOptions,
  ...(config.supportsTools !== false && { tools }),
  telemetry: { functionId: config.telemetryId },
});
```

Uses `stopWhen: isStepCount(2)` — step 1 is the tool call, step 2 is the text response using tool results. The default `isStepCount(1)` would stop after the tool call without generating a follow-up text response.

### Frontend Changes

#### Type sharing strategy

The frontend does not import backend types directly. Instead, it uses `part.type.startsWith("tool-")` to catch all tool parts generically, and the `ToolCallDisplay` component renders them without needing compile-time knowledge of specific tool names. This avoids cross-package type dependencies. If per-tool custom renderers are added later, a shared types package can be introduced then.

#### Message part rendering

`index.tsx` currently renders `reasoning` and `text` parts, returning `null` for everything else. This changes to handle tool parts:

```tsx
{message.parts.map((part, i) => {
  if (part.type === "reasoning") {
    return (
      <Reasoning key={i} isStreaming={part.state === "streaming"}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }
  if (part.type === "text") {
    return <MessageResponse key={i}>{part.text}</MessageResponse>;
  }
  // Tool parts: tool-getWeather, tool-calculate, etc.
  if (part.type.startsWith("tool-")) {
    return <ToolCallDisplay key={i} part={part} />;
  }
  return null;
})}
```

#### Tool display via ai-elements `Tool` component

Install the `Tool` component from ai-elements (`npx ai-elements@latest add tool`). This provides a pre-built collapsible UI with:

- `<Tool>` — collapsible wrapper
- `<ToolHeader>` — shows tool name, status badge (Pending / Running / Completed / Error)
- `<ToolContent>` — collapsible body
- `<ToolInput>` — formatted JSON display of tool parameters
- `<ToolOutput>` — rendered output or error text

Usage in the message loop:

```tsx
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";

// Inside message.parts.map:
if (part.type.startsWith("tool-")) {
  return (
    <Tool key={i} defaultOpen={part.state === "output-available" || part.state === "output-error"}>
      <ToolHeader type={part.type} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
```

Custom per-tool renderers (e.g., a weather card) can be added later by switching on the specific `part.type` before falling through to the generic display.

### Dependencies

- `zod` — added to backend for tool input schema definitions (AI SDK v7 uses Zod for `inputSchema`)

### Files Changed

**Backend (new):**
- `packages/backend/src/tools/index.ts` — tool registry
- `packages/backend/src/tools/weather.ts` — weather tool
- `packages/backend/src/tools/calculator.ts` — calculator tool

**Backend (modified):**
- `packages/backend/src/providers.ts` — add `supportsTools` to `ModelConfig`
- `packages/backend/src/routes/chat.ts` — import tools, pass conditionally to `streamText`
- `packages/backend/package.json` — add `zod` dependency

**Frontend (installed via ai-elements CLI):**
- `packages/frontend/src/components/ai-elements/tool.tsx` — `Tool` component (via `npx ai-elements@latest add tool`)

**Frontend (modified):**
- `packages/frontend/src/routes/index.tsx` — render tool parts using the `Tool` component, type `useChat` with tool-aware message type

## Testing

- Verify tool calls render in the UI when using an OpenAI model
- Verify the Ollama model path still works without tools (when `supportsTools: false`)
- Verify that tool input/output display correctly in all states
- Verify that `zod` schema validation rejects malformed tool inputs

## Scope boundaries

**In scope:** Server-side tool execution, tool registry pattern, model-aware opt-out, frontend rendering of tool I/O.

**Out of scope (future subsystems):** Client-side tools, multi-step agentic loops, guardrails/middleware, sandbox execution, structured output, tool approval UX, per-tool custom renderers beyond the default JSON display.
