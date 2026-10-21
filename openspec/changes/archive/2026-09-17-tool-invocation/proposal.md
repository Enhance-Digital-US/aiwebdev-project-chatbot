# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Both are historical and may not match the code today. Current requirements live in `openspec/specs/tools` and `chat-ui`.

## Why

Let the model call backend functions during a conversation. This was the base for later MCP, skills and sandbox work.

## What Changes

- Local tool registry with Zod input schemas, and a per-model `supportsTools` opt-out.
- Generic tool-part rendering in the UI.
- Planned tools were weather and calculator. The calculator was later replaced by `convertUnits`, and `executeCode` was added.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/tools` and `chat-ui`.

## Impact

New `tools/` module, `zod` dependency, frontend tool display component.
