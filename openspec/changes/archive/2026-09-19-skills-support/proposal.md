# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Both are historical and may not match the code today. Current requirements live in `openspec/specs/skills`.

## Why

Let the model take on behavioral instructions on demand (progressive disclosure) instead of putting them all in the system prompt.

## What Changes

- `SKILL.md` files bundled as raw text, a skill catalog in the system prompt, and a `loadSkill` tool.
- Demo skills `eli5-explainer` and `senior-architect`. No frontend changes.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/skills`.

## Impact

New `skills/` module and a Wrangler `Text` module rule for `.md` files.
