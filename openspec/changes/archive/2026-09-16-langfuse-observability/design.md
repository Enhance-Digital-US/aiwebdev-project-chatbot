# Langfuse Observability Integration

**Date:** 2026-09-16
**Status:** Implemented

## Overview

Integrates [Langfuse](https://langfuse.com) observability into the Hono + Cloudflare Workers chatbot backend via OpenTelemetry, providing automatic tracing of all AI SDK `streamText`/`generateText` calls with model name, token usage, prompts, completions, and tool call data.

## Architecture

```
AI SDK streamText()
    │
    ▼
@ai-sdk/otel (OpenTelemetry class)
    │  creates gen_ai.* semantic convention spans
    ▼
@opentelemetry/api
    │
    ▼
BasicTracerProvider + SimpleSpanProcessor
    │  exports immediately on span end
    ▼
LangfuseFetchExporter (custom)
    │  uses fetch() — Workers-compatible
    ▼
Langfuse OTLP endpoint (US region)
POST https://us.cloud.langfuse.com/api/public/otel/v1/traces
```

## Approach: Lightweight OTel + @ai-sdk/otel

### Why not full `@opentelemetry/sdk-node`?

Cloudflare Workers can't run the full Node OTel SDK:
- `@opentelemetry/exporter-trace-otlp-http` uses Node's `http.request()`, not `fetch()`
- Resource detectors import `os`, `child_process`, `fs`
- gRPC and Zipkin exporters are Node-only

### Why not Workers native `[observability.traces]`?

Workers native OTel (`wrangler.toml` `[observability.traces]`) and `@opentelemetry/api` spans are separate trace trees with different trace IDs — enabling both sends Langfuse two disconnected traces per request. The AI SDK's `@ai-sdk/otel` only instruments the `@opentelemetry/api` tree.

### Chosen stack

| Package | Role |
|---------|------|
| `@ai-sdk/otel` | Registers `OpenTelemetry` class with AI SDK; creates rich `gen_ai.*` spans |
| `@opentelemetry/api` | Trace context API |
| `@opentelemetry/sdk-trace-base` | `BasicTracerProvider`, `SimpleSpanProcessor` |
| `@opentelemetry/resources` | `resourceFromAttributes()` — avoids Node auto-detectors |
| `@opentelemetry/core` | `ExportResultCode` enum |
| `@opentelemetry/otlp-transformer` | `JsonTraceSerializer` for OTLP JSON encoding |

## Key Design Decisions

### 1. Custom fetch-based exporter

`LangfuseFetchExporter` uses the Web `fetch()` API instead of Node's `http.request()`. This is the only way to make OTLP exports work inside Cloudflare Workers.

**Auth:** Basic auth header — `base64(publicKey:secretKey)`.
**Required header:** `x-langfuse-ingestion-version: 4`.

### 2. Lazy provider initialization

Workers bindings (`c.env`) are only available during request handling, not at module scope. The `initTelemetry()` function creates the provider on first request and is idempotent — subsequent calls are no-ops.

### 3. SimpleSpanProcessor (not Batch)

`BatchSpanProcessor` relies on timers (`setTimeout`) that won't fire between serverless requests. `SimpleSpanProcessor` exports immediately when each span ends — correct for Workers' short-lived request model.

### 4. Flush timing: `onEnd` callback, not post-middleware

**Critical:** In Hono on Workers, `await next()` in middleware resolves when the `Response` object is *created*, not when the SSE stream finishes. At that point, `@ai-sdk/otel` spans haven't ended — token counts are zero.

The flush is placed inside each route's `streamText({ onEnd() { ... } })` callback, which fires after streaming completes and spans carry full `gen_ai.usage.*` data. The flush promise is passed to `c.executionCtx.waitUntil()` so it runs after the response is returned to the client.

### 5. Explicit resource attributes

`resourceFromAttributes({ "service.name": "chatbot-api" })` avoids triggering Node-only auto-detection code paths in `@opentelemetry/resources`.

## Span Attributes Sent to Langfuse

`@ai-sdk/otel` automatically populates these `gen_ai.*` semantic convention attributes:

| Attribute | Langfuse mapping |
|-----------|-----------------|
| `gen_ai.request.model` | Generation model name |
| `gen_ai.response.model` | Actual model used |
| `gen_ai.usage.input_tokens` | Input token count |
| `gen_ai.usage.output_tokens` | Output token count |
| `gen_ai.prompt` | Prompt messages (JSON) |
| `gen_ai.completion` | Completion text |
| `gen_ai.response.finish_reasons` | Finish reason |

Additional attributes can be set per-call:
- `langfuse.user.id` — associates trace with a user
- `langfuse.session.id` — groups traces into a session
- `telemetry.functionId` — names the function in Langfuse

### Privacy

With `@ai-sdk/otel` registered, prompts and completions are sent to Langfuse by default. To disable per-call:

```typescript
streamText({
  // ...
  telemetry: { recordInputs: false, recordOutputs: false },
});
```

## Files

| File | Role |
|------|------|
| `packages/backend/src/telemetry.ts` | New — exporter, provider init, flush helper |
| `packages/backend/src/index.ts` | Updated — telemetry middleware + per-route `onEnd` flush |
| `packages/backend/package.json` | Updated — 6 OTel dependencies added |
| `packages/backend/.dev.vars` | Updated — Langfuse key placeholders (gitignored) |

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LANGFUSE_PUBLIC_KEY` | Langfuse project public key | `pk-lf-abc123...` |
| `LANGFUSE_SECRET_KEY` | Langfuse project secret key | `sk-lf-xyz789...` |
| `OPENAI_API_KEY` | OpenAI API key (pre-existing) | `sk-proj-...` |
