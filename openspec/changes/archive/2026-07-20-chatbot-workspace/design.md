# Chatbot Workspace Design

## Overview

A pnpm monorepo with two packages — a React frontend and a Hono API backend — implementing a streaming chat UI using the Vercel AI SDK and AI Elements component library. Deployed to Cloudflare (Workers for backend, Pages for frontend static assets).

## Architecture

### Workspace Layout

```
chatbot/
├── pnpm-workspace.yaml
├── package.json                  # root scripts (dev via concurrently)
├── .nvmrc                        # Node 22
├── packages/
│   ├── frontend/
│   │   ├── package.json
│   │   ├── vite.config.ts        # proxy /api → localhost:8787
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── components.json       # shadcn/ui registry config
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx           # chat UI
│   │   │   ├── app.css           # Tailwind CSS 4 entry
│   │   │   └── components/
│   │   │       └── ai-elements/  # installed via ai-elements CLI
│   │   └── public/
│   └── backend/
│       ├── package.json
│       ├── wrangler.toml
│       ├── tsconfig.json
│       └── src/
│           └── index.ts          # Hono app
```

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Package manager | pnpm | latest |
| Frontend framework | React | 19 |
| Build tool | Vite | latest |
| CSS | Tailwind CSS | 4 |
| UI components | shadcn/ui + AI Elements | latest |
| Chat hook | @ai-sdk/react (useChat) | latest |
| Backend framework | Hono | latest |
| AI SDK | ai + @ai-sdk/openai | latest |
| Runtime | Cloudflare Workers | — |
| Static hosting | Cloudflare Pages | — |

## Data Flow

```
User types message
    ↓
PromptInput (AI Elements) → onSubmit
    ↓
useChat({ api: '/api/chat' })
    → POST /api/chat  { messages: UIMessage[] }
    ↓
Hono route handler
    → streamText({ model: openai('gpt-4o-mini'), messages })
    → createUIMessageStreamResponse({ stream: toUIMessageStream(...) })
    ↓
Streamed SSE response
    ↓
useChat receives chunks → updates messages array
    ↓
Conversation + Message (AI Elements) render incrementally
```

## Backend: Hono Worker

**Route**: `POST /api/chat`

The handler:
1. Extracts `messages` from the request body
2. Calls `streamText` with the OpenAI provider and the message history
3. Returns a `UIMessageStreamResponse` wrapping the stream

**Environment**: `OPENAI_API_KEY` stored as a CF Worker secret (locally in `.dev.vars`).

**CORS**: Configured for dev (localhost origins). In production, same-origin via CF routing.

## Frontend: React + Vite

**Entry point**: `App.tsx` renders the chat interface using three AI Elements components:

1. **Conversation / ConversationContent** — scrollable message list container
2. **Message / MessageContent / MessageResponse** — individual messages with role-based styling (`from="user"` / `from="assistant"`)
3. **PromptInput / PromptInputTextarea / PromptInputSubmit** — input form with streaming-aware submit button

**State management**: Entirely via `useChat` hook — no additional state library needed.

**Dev proxy**: Vite config proxies `/api` to `http://localhost:8787` (wrangler dev default port).

## AI Elements Installation

Components are added via the AI Elements CLI:
```bash
pnpm dlx ai-elements@latest add conversation message prompt-input
```

This downloads component source code into `src/components/ai-elements/`. Components are owned code (shadcn model), not node_modules.

## Dev Experience

**Root `pnpm dev`**: Runs both servers via `concurrently`:
- Frontend: `vite` on port 5173
- Backend: `wrangler dev` on port 8787

**Root `pnpm build`**: Builds both packages.

## Deployment

- **Backend**: `wrangler deploy` from `packages/backend/`
- **Frontend**: `vite build` produces `dist/` → deploy to CF Pages
- Production API routing: CF Pages proxies `/api/*` to the Worker (or use a custom domain)

## Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| OPENAI_API_KEY | backend/.dev.vars (dev), CF Worker secret (prod) | OpenAI API authentication |

## Decisions Log

- **Approach A (separate packages)** chosen over monolith worker or shared types — cleanest separation, independent deploys
- **OpenAI (gpt-4o-mini)** as the AI provider — user selected
- **Vite proxy** for dev — standard, no extra tooling
- **TailwindCSS 4** — latest, CSS-based config
- **AI Elements** for chat UI — composable, AI SDK-native components
