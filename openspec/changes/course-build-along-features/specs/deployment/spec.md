# Spec Delta

## MODIFIED Requirements

### Requirement: Local development
`pnpm dev` at the root SHALL run the backend (`wrangler dev`, port 8788) and the frontend (Vite, port 5173) together, with Vite proxying `/api` to `localhost:8788`. Port 8787 is left free for the course's issue-tracker MCP server. Local secrets SHALL live in `packages/backend/.dev.vars`, which MUST be gitignored, and the repo SHALL ship `packages/backend/.dev.vars.example` listing every variable with placeholder values.

#### Scenario: Dev chat request
- **WHEN** the frontend on `localhost:5173` posts to `/api/chat`
- **THEN** Vite forwards it to the backend on port 8788

#### Scenario: Running beside the issue tracker
- **WHEN** the issue-tracker server runs on port 8787 and the chatbot runs `pnpm dev`
- **THEN** both start without a port conflict

#### Scenario: First-time setup
- **WHEN** a learner copies `.dev.vars.example` to `.dev.vars` and fills in their keys
- **THEN** the backend starts with every variable it reads defined

## ADDED Requirements

### Requirement: Workflow and database bindings
The Worker SHALL bind the bug-report Workflow and a D1 database in local development and in production, and its D1 schema SHALL be applied with a documented command.

#### Scenario: Fresh deploy
- **WHEN** the Worker is deployed with the documented setup steps
- **THEN** the workflow can be started and conversations are stored

### Requirement: Client metadata is publicly reachable
The deployed Worker SHALL serve its OAuth Client ID Metadata Document at a fixed path, reachable without a Cloudflare Access login, while every other path stays behind Access.

#### Scenario: Issue tracker fetches the metadata
- **WHEN** the issue-tracker server fetches the chatbot's client metadata URL without credentials
- **THEN** it receives the JSON document, not an Access login page

#### Scenario: Other paths stay protected
- **WHEN** an unauthenticated request asks for `/` or `/api/chat`
- **THEN** Access requires login
