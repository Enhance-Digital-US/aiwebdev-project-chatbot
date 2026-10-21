# Cloudflare Workers Deployment Design

## Overview

Deploy the chatbot (React SPA + Hono API) to production on Cloudflare Workers — not Pages — at `https://chatbot.course-projects.ai-web.dev`, as the first of several course projects hosted under `course-projects.ai-web.dev`.

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Topology | **Single Worker** serves the Vite build via Workers Static Assets; only `/api/*` runs Hono (`run_worker_first`) | Same origin → no CORS, Clerk cookies/tokens work without cross-origin config, one deploy |
| D2 | Hostname | **Per-project 2-level subdomain** `chatbot.course-projects.ai-web.dev` via a Workers **Custom Domain** | Groups course projects; each project is its own origin (cookies, storage, Clerk sessions isolated); no app changes. Custom Domains issue a per-hostname certificate covering 2-level subdomains with no Advanced Certificate Manager subscription |
| D3 | Rejected: path-based `course-projects.ai-web.dev/chatbot` | — | Requires Vite `base`, router basepath, API prefix, nested asset dir; SPA fallback always serves root `/index.html`; all projects share one origin |
| D4 | Rejected: `chatbot.ai-web.dev` | — | Works (Universal SSL), but no grouping under course-projects |
| D5 | Auth rollout | **Deploy first with auth off, add Clerk production instance afterwards** | Decouples platform risk (DNS/cert/secrets) from auth risk; Clerk production instances need DNS records on an owned domain, which only makes sense once the hostname is live |
| D6 | Clerk production domain | `chatbot.course-projects.ai-web.dev` (the app's own hostname) | Keeps Clerk sessions scoped to this project rather than shared across every `*.ai-web.dev` / `*.course-projects.ai-web.dev` sibling |
| D7 | `authorizedParties` | Explicit allow-list from `CLERK_AUTHORIZED_PARTIES` var (comma-separated origins). Prod value in `wrangler.jsonc`; `http://localhost:5173` in `.dev.vars` | Request-URL origin is wrong in dev (Vite proxy rewrites to `:8787`); echoing the `Origin` header defeats the check. Invalid entries throw (fail loud) rather than silently de-authenticating users |
| D8 | `workers.dev` URL | Keep enabled for the first deploy as a fallback; **disable** (`workers_dev: false`, `preview_urls: false`) once the custom domain is verified | One canonical origin; the `workers.dev` origin is not in the auth allow-list |
| D9 | Deploy mechanism | Manual `pnpm run deploy` from a developer machine (wrangler OAuth login) | No Workers Builds / CI deploy yet — out of scope |
| D10 | Guardrails in prod | `GUARDRAIL_TIER: "simple"` in `wrangler.jsonc` vars | `local` (Ollama) cannot run at the edge |

## Cloudflare Account Facts (verified 2026-10-07)

- Account: **Enhance Digital LLC** (`9dff37a609d16c31de78f32f94783041`), wrangler OAuth login.
- Zone `ai-web.dev`: active, Free plan, Cloudflare nameservers. No existing `course-projects` / `chatbot` records, no wildcard.
- Wrangler OAuth token: `workers_routes (write)`, `ssl_certs (write)`, `zone (read)` — enough for `wrangler deploy` to create Custom Domains. It **cannot read or write DNS records**; Clerk DNS records must be added in the Cloudflare dashboard.
- workers.dev subdomain: `enhancedigital` (default URL `chatbot.enhancedigital.workers.dev`).
- Neither `chatbot` nor `chatbot-api` Worker exists yet — no orphaned secrets.

## Already Implemented (pre-plan, uncommitted)

Single-Worker `assets` config, compat date `2026-07-21` (max supported by pinned wrangler 4.112), observability logs, `GUARDRAIL_TIER` var, frontend-first build order, `pnpm run deploy`, `mkdir -p` dev guard, CI build fix, `allowBuilds`, `.env` gitignore, `LANGFUSE_BASE_URL`, dev-only Ollama model, 400 for unknown model, CORS removed, `getAuthorizedParties()` stub returning `[]`, README/AGENTS docs.

## Out of Scope

- CI-driven deploys / Workers Builds.
- Verifying the eval workflow's `wrangler dev` starts in CI without Cloudflare credentials (the `AI` binding is always remote) — pre-existing, track separately.
- Gating `/api/chat` behind sign-in (auth only tags Langfuse traces).
- A `course-projects.ai-web.dev` landing/index Worker.
- The 4 pre-existing AI SDK v7 type errors in `tsc --noEmit`.

## Addendum (2026-10-15): Auth moved to Cloudflare Access

In-app Clerk auth was replaced by edge auth. This supersedes D5–D7 and completes D8:

- **Enforcement:** a Cloudflare Zero Trust Access self-hosted application on `chatbot.course-projects.ai-web.dev` (team `enhancedigital`) gates every path, `/api/*` included, with Clerk configured as an OIDC identity provider. Unlike the old design ("auth only tags traces"), `/api/chat` is now actually gated.
- **Removed:** `@clerk/react`, `@clerk/backend`, `auth.tsx`, `authorized-parties.ts`, `CLERK_*` bindings/secrets, `VITE_CLERK_PUBLISHABLE_KEY`, frontend `.env.example`. No Clerk production instance or Clerk DNS records are needed for the app.
- **User tracing:** the Worker verifies the `Cf-Access-Jwt-Assertion` JWT (`jose`, remote JWKS at `<team>/cdn-cgi/access/certs`, issuer `ACCESS_TEAM_DOMAIN`, audience `ACCESS_AUD`) and sets `langfuse.user.id` to `email` (fallback `sub`). Verification failures are logged and leave the request anonymous, since Access has already enforced login.
- **D8 done:** `workers_dev: false`, `preview_urls: false`. Access covers only the custom hostname, so those URLs would have been unauthenticated entry points.
