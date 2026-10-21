# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Its Clerk tasks were abandoned when auth moved to Cloudflare Access. Both are historical and may not match the code today. Current requirements live in `openspec/specs/deployment` and `auth`.

## Why

Ship the chatbot to production on Cloudflare Workers under `course-projects.ai-web.dev`.

## What Changes

- One Worker serving the SPA via Workers Static Assets, with Hono only for `/api/*`, at the custom domain `chatbot.course-projects.ai-web.dev`.
- Manual `pnpm run deploy`; `GUARDRAIL_TIER=simple` in production.
- Planned in-app Clerk auth (D5–D7) was replaced on 2026-10-15 by Cloudflare Access at the edge (see the addendum in `design.md`).

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/deployment` and `auth`.

## Impact

`wrangler.jsonc` assets, routes and vars; removes CORS; adds `jose` and Access vars.
