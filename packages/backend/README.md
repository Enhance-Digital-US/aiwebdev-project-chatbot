# Chatbot API Backend

Hono + Cloudflare Workers backend with AI SDK v7. The sections below cover what this checkpoint of the course chatbot includes.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Local Development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example file to `packages/backend/.dev.vars` (gitignored) and fill in your keys:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars.example` lists every variable the backend reads, with comments. At minimum set `OPENAI_API_KEY` and `AI_GATEWAY_TOKEN`.

Every OpenAI call goes through **Cloudflare AI Gateway**. The account id and gateway name are `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_NAME` in `wrangler.jsonc` `vars` (override them in `.dev.vars` to use your own gateway). The gateway is authenticated: create a token under **AI Gateway → your gateway → Settings → Authentication** and set it as `AI_GATEWAY_TOKEN`.

### 3. Start the dev server

```bash
pnpm --filter backend dev
```

The API runs at `http://localhost:8788`.

### 4. Test

```bash
curl -X POST http://localhost:8788/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/chat` | POST | Accepts `{ messages, model? }`, streams back via AI SDK UIMessageStream |

The `model` field defaults to `gpt-6-luna` (`DEFAULT_MODEL`). Available models are registered in `providers.ts`:

| Model ID | Provider | Notes |
|----------|----------|-------|
| `gpt-6-luna` | OpenAI | Default; reasoning model (default effort, reasoning not streamed); via AI Gateway |

## Project Structure

```
packages/backend/
├── src/
│   ├── index.ts           # Hono app entry point
│   ├── providers.ts       # Model registry (OpenAI)
│   └── routes/
│       └── chat.ts        # POST /api/chat — orchestrates all subsystems
├── .dev.vars              # Local secrets (gitignored)
├── package.json
├── tsconfig.json
└── wrangler.jsonc         # Cloudflare Workers config
```

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | Yes | — | OpenAI model |
| `AI_GATEWAY_ACCOUNT_ID` | Yes | `wrangler.jsonc` vars | Cloudflare account that owns the AI Gateway |
| `AI_GATEWAY_NAME` | Yes | `wrangler.jsonc` vars | AI Gateway that OpenAI calls go through |
| `AI_GATEWAY_TOKEN` | Yes | — | Gateway auth token (`cf-aig-authorization`), a secret |
