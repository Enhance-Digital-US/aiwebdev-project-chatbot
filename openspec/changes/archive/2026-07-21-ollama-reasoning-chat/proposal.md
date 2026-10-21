# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Both are historical and may not match the code today. Current requirements live in `openspec/specs/chat-api` and `chat-ui`.

## Why

Show reasoning traces from a local model next to the OpenAI chat.

## What Changes

- Ollama provider (`gemma4:12b`, `think: true`) with reasoning parts streamed to the client.
- TanStack Router and a collapsible reasoning display.
- Originally a separate `/api/ollama-chat` route and page. Later folded into the single `/api/chat` endpoint with a model registry and model picker.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/chat-api` and `chat-ui`.

## Impact

Adds `ollama-ai-provider-v2`, `@tanstack/react-router`; needs a local Ollama server.
