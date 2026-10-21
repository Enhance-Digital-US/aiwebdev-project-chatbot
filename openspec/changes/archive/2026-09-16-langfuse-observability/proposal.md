# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; no implementation plan was written. It is historical and may not match the code today. Current requirements live in `openspec/specs/telemetry`.

## Why

Get visibility into model calls (prompts, completions, token usage) from inside Cloudflare Workers, where the Node OpenTelemetry SDK does not run.

## What Changes

- `@ai-sdk/otel` spans exported to Langfuse through a custom `fetch`-based OTLP exporter.
- Lazy init, `SimpleSpanProcessor`, and flushing in `streamText` `onEnd` via `waitUntil`.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/telemetry`.

## Impact

New `telemetry.ts`, six OpenTelemetry dependencies, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` secrets.
