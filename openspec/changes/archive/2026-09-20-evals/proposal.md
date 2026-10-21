# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Before the migration only 10 of 36 were ticked, and some, such as a scheduled Langfuse scorer, may never have shipped. Both are historical and may not match the code today. Current requirements live in `openspec/specs/evals`.

## Why

Catch safety, quality and tool-use regressions before merge, and score production traffic.

## What Changes

- New `packages/evals` with Promptfoo suites (safety, quality, tools) run against the full stack.
- CI gate on pull requests, plus Braintrust, Langfuse online scoring and Garak documentation as extensions.
- The design used `/chat`; the endpoint is `/api/chat`. The tool-use threshold in CI is 80%, not the designed 90%.

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/evals`.

## Impact

New workspace package, GitHub Actions workflow, `OPENAI_API_KEY` CI secret.
