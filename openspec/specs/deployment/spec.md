# deployment Specification

## Purpose

How the monorepo is developed locally, built, and shipped to production as a single Cloudflare Worker serving both the SPA and the API.

## Requirements

### Requirement: Monorepo layout
The repository SHALL be a pnpm workspace with three packages: `frontend` (React + Vite SPA), `backend` (Hono on Cloudflare Workers) and `evals` (eval tooling, kept out of the Worker bundle). Local development SHALL use Node 22.

#### Scenario: Eval dependencies isolated
- **WHEN** the Worker is built
- **THEN** eval dependencies such as promptfoo and braintrust are not in its bundle

### Requirement: Local development
`pnpm dev` at the root SHALL run the backend (`wrangler dev`, port 8787) and the frontend (Vite, port 5173) together, with Vite proxying `/api` to `localhost:8787`. Local secrets SHALL live in `packages/backend/.dev.vars`, which MUST be gitignored.

#### Scenario: Dev chat request
- **WHEN** the frontend on `localhost:5173` posts to `/api/chat`
- **THEN** Vite forwards it to the backend on port 8787

### Requirement: Build order
`pnpm build` SHALL build the frontend first and then the backend, because the backend bundles `frontend/dist` as static assets.

#### Scenario: Clean build
- **WHEN** `pnpm build` runs in a fresh checkout
- **THEN** `frontend/dist` exists before the backend dry-run bundle is produced

### Requirement: Single Worker topology
Production SHALL be one Worker named `chatbot` that serves the Vite build as Workers Static Assets, runs the Hono app only for `/api/*`, and falls back to `index.html` for other unmatched paths so client-side routes work.

#### Scenario: Deep link
- **WHEN** a browser requests a non-API path that is not a static file
- **THEN** the SPA's `index.html` is served

#### Scenario: API path
- **WHEN** a request targets `/api/chat`
- **THEN** the Worker code handles it before static assets

### Requirement: Production hostname
The Worker SHALL be served at `https://chatbot.course-projects.ai-web.dev` through a Workers Custom Domain, which creates its DNS record and certificate on deploy.

#### Scenario: Deploy creates the domain
- **WHEN** `wrangler deploy` runs with the custom domain route
- **THEN** the hostname resolves to the Worker over HTTPS

### Requirement: Manual deploy
Deployment SHALL be `pnpm run deploy` from a developer machine, which builds and then runs `wrangler deploy`. Production secrets (`OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `E2B_API_KEY`) SHALL be Worker secrets and MUST NOT be committed.

#### Scenario: Deploy command
- **WHEN** a developer runs `pnpm run deploy` at the root
- **THEN** the frontend and backend are built and the Worker is deployed

### Requirement: Production configuration
Production vars SHALL set `MCP_IMPL` to `raw`, `GUARDRAIL_TIER` to `simple`, `SANDBOX_PROVIDER` to `e2b`, and the Access team domain and audience. The Worker SHALL have a Workers AI binding and observability logs enabled. Ollama-backed features are local-only.

#### Scenario: Ollama unavailable at the edge
- **WHEN** the app runs in production
- **THEN** guardrails do not use the `local` tier and the UI does not offer the Ollama model
