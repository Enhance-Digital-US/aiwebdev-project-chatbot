# Chatbot API Backend

Hono + Cloudflare Workers backend with AI SDK v7. The sections below cover what this checkpoint of the course chatbot includes.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)
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

`.dev.vars.example` lists every variable the backend reads, with comments. At minimum set `OPENAI_API_KEY`.

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
| `POST /api/chat` | POST | Accepts `{ messages }`, streams back via AI SDK UIMessageStream |

The route calls `gpt-6-luna` through the OpenAI provider.

## Project Structure

```
packages/backend/
├── src/
│   ├── index.ts           # Hono app entry point
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
