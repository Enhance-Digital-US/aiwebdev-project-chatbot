# Proposal

## Why

This chatbot is the build-along project for module 02 of the ai-web.dev course (website change `chatbot-build-along`). Each lesson adds one capability. Three lessons (Structured Data, Durable Workflows, Cost) teach things the app doesn't do yet, and the app doesn't use the course's own issue-tracker MCP server. The app also needs to resemble a real team chat product: a "Team Assistant" with chat history, not a bare demo page.

## What Changes

- **AI Gateway:** every model call is routed through Cloudflare AI Gateway. OpenAI stays the default provider.
- **Team Assistant persona:** the system prompt moves into its own versioned module.
- **Structured output:** follow-up suggestion chips after each answer, and a generated title for each conversation.
- **Issue tracker over MCP:**
  - The `issue-tracker` server joins the server list.
  - Its tool calls carry the right credential. Locally, that's a development token minted on demand for a configurable persona.
  - When deployed, it's per-user OAuth: login as a persona, with CIMD or dynamic client registration.
- **MRTR elicitation:** when a server asks for confirmation mid-call, the user sees a confirmation card. The call is retried with their answer instead of failing.
- **Bug-report workflow:** a Cloudflare Workflow turns a pasted error log into a bug report. It runs redact → draft → dedupe → wait for approval → file, and files exactly once.
- **Chat persistence:** conversations, messages, titles and workflow links are stored in D1, and a history sidebar lists past chats.
- **Usage and cost:** per-message token usage, a cost meter per conversation, a per-chat token cap, and gateway caching.
- **Evals:** cases for issue-tracker tool use, the bug-report tool, and log redaction.
- **Local development:**
  - The backend moves from port 8787 to **8788**, because the issue-tracker server needs 8787 and rejects any other Host. **BREAKING** for anyone running `wrangler dev` with the old port.
  - `packages/backend/.dev.vars.example` is added, so local setup is a copy step.

## Capabilities

### New Capabilities
- `bug-report-workflow`: the durable pasted-log → bug-report workflow, its approval step, and its idempotent filing.
- `chat-persistence`: stored conversations, messages and titles; the history sidebar; reconnecting a conversation to its workflows.
- `usage-and-cost`: per-message usage reporting, cost estimation, per-chat token caps, and response caching.

### Modified Capabilities
- `chat-api`:
  - model calls go through AI Gateway
  - the system prompt becomes the Team Assistant persona
  - the endpoint produces follow-up suggestions and titles
- `chat-ui`: suggestion chips, the title header, confirmation and workflow cards, the history sidebar, the cost meter.
- `mcp-client`:
  - the `issue-tracker` server joins the server list
  - per-request credentials
  - MRTR elicitation instead of an error
- `deployment`: the local backend port, the `.dev.vars.example` file, and the Workflow and D1 bindings in every environment.
- `evals`: coverage for the issue tracker, the bug-report tool and redaction.

## Impact

- **Backend:**
  - modified: `providers.ts`, `routes/chat.ts`, `mcp/*`, `wrangler.jsonc`
  - new: `prompts/`, `structured/`, `workflows/`, `routes/workflows.ts`, `db/`, `oauth/`
- **Frontend:** `routes/index.tsx`, plus new cards, chips, the sidebar and the meter.
- **Evals:** datasets and the provider URL (port 8788).
- **Depends on mcp-server change `idempotent-issue-creation`:** the `external_id` field on `create_issue`, which the workflow's filing step needs.
- **Depends on mcp-server change `add-simulated-roles-oauth`:** the personas, the OAuth server, and the dev-only token endpoint.
- **Followed by `course-checkpoint-history`:** that change rebuilds this repo's history into per-lesson tags, using this change's final state as its target.
