# Chatbot API Backend

Hono on Cloudflare Workers: the scaffold for the course chatbot. It has no routes yet.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/)

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

`.dev.vars.example` lists every variable the backend reads, with comments. The scaffold needs no keys yet.

### 3. Start the dev server

```bash
pnpm --filter backend dev
```

The API runs at `http://localhost:8788`.

## Project Structure

```
packages/backend/
├── src/
│   └── index.ts           # Hono app entry point
├── .dev.vars              # Local secrets (gitignored)
├── package.json
├── tsconfig.json
└── wrangler.jsonc         # Cloudflare Workers config
```
