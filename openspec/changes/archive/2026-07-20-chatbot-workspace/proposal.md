# Proposal

> Migrated from `docs/superpowers/` on 2026-10-20. `design.md` is the original design doc, kept verbatim; `tasks.md` is the original implementation plan, with every checkbox ticked in bulk during the migration (so `openspec validate --archived` passes). The ticks do not record which individual tasks were done. Both are historical and may not match the code today. Current requirements live in `openspec/specs/chat-api`, `chat-ui` and `deployment`.

## Why

Start the project: a working streaming chat app to build later AI features on.

## What Changes

- pnpm monorepo with a React 19 + Vite + Tailwind 4 frontend and a Hono backend on Cloudflare Workers.
- `POST /api/chat` streaming `gpt-4o-mini` replies through the AI SDK, rendered with AI Elements and `useChat`.
- `pnpm dev` runs both servers; Vite proxies `/api` to wrangler on :8787.
- Planned deploy: Worker for the API and Pages for the frontend. This was later replaced by a single Worker (see `2026-10-07-workers-deployment`).

## Capabilities

Recorded before OpenSpec was adopted, so this change has no delta specs (`skip_specs: true`). Its behavior is captured in `openspec/specs/chat-api`, `chat-ui` and `deployment`.

## Impact

New `packages/frontend` and `packages/backend`; `OPENAI_API_KEY` secret.
