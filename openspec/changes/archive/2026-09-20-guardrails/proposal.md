# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; no implementation plan was written. It is historical and may not match the code today. Current requirements live in `openspec/specs/guardrails`.

## Why

Add runtime safety checks on input, tool results and output, with a cheap baseline and stronger classifier options.

## What Changes

- AI SDK language-model middleware with three tiers (`simple`, `local`, `cloud`) chosen by `GUARDRAIL_TIER`.
- Sentence-level stream buffering. The design said to halt the stream on unsafe output. The code instead replaces unsafe sentences with `[Content filtered]`.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/guardrails`.

## Impact

New `guardrails/` module, Workers AI binding, `GUARDRAIL_TIER` and `OLLAMA_BASE_URL` vars.
