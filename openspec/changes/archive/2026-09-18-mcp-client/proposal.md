# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Both are historical and may not match the code today. Current requirements live in `openspec/specs/mcp-client`.

## Why

Give the model tools from external MCP servers, and compare a hand-rolled client with the AI SDK one.

## What Changes

- Static MCP server list (`cf-docs`, `deepwiki`), parallel connect with a 5s timeout, `${server}_${tool}` namespacing.
- Two loaders behind one interface, chosen by `MCP_IMPL`. The design defaulted to `ai-sdk`. The default later became `raw` (the AI SDK client fails on Workers), and the raw client gained dual-era `2026-07-28` support.
- Step limit raised to 5; `dynamic-tool` parts rendered in the UI.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/mcp-client`.

## Impact

New `mcp/` module, `@ai-sdk/mcp` dependency, `MCP_IMPL` var.
