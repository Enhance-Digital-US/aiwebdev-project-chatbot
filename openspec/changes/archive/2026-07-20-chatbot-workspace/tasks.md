# Chatbot Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Scaffold a pnpm monorepo with a React + Vite frontend and Hono API backend that implements a streaming chat UI using the Vercel AI SDK with AI Elements components, deployable to Cloudflare.

**Architecture:** Two workspace packages — `packages/frontend` (React 19, Vite, TailwindCSS 4, shadcn/ui, AI Elements) and `packages/backend` (Hono on Cloudflare Workers with AI SDK + OpenAI). The frontend proxies `/api` to the backend dev server. A root `pnpm dev` command runs both via `concurrently`.

**Tech Stack:** pnpm workspaces, React 19, Vite, TailwindCSS 4, shadcn/ui, AI Elements, Hono, Cloudflare Workers, Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`), TypeScript

## Global Constraints

- All packages use latest versions at time of install
- Node 22 (specified in `.nvmrc`)
- pnpm as the sole package manager
- TypeScript strict mode in all packages
- No `tailwind.config.js` — TailwindCSS 4 uses CSS-based configuration
- AI Elements components install to `src/components/ai-elements/` (shadcn copy model)
- Backend environment variables go in `.dev.vars` (dev) and CF Worker secrets (prod)
- `.dev.vars` must be in `.gitignore`

---

## File Map

### Root
| File | Responsibility |
|------|---------------|
| `pnpm-workspace.yaml` | Declares `packages/*` as workspace members |
| `package.json` | Root dev/build scripts via `concurrently` |
| `.nvmrc` | Pins Node 22 |
| `.gitignore` | Standard ignores + `.dev.vars` |

### packages/backend
| File | Responsibility |
|------|---------------|
| `package.json` | Hono, AI SDK, OpenAI provider deps; dev/deploy scripts |
| `wrangler.toml` | CF Worker config: name, compatibility date, entry point |
| `tsconfig.json` | TypeScript config for worker environment |
| `.dev.vars` | Local dev secrets (`OPENAI_API_KEY`) — gitignored |
| `src/index.ts` | Hono app: CORS middleware + `POST /api/chat` route |

### packages/frontend
| File | Responsibility |
|------|---------------|
| `package.json` | React, Vite, Tailwind, shadcn, AI SDK React deps |
| `vite.config.ts` | React plugin, Tailwind plugin, `@` alias, `/api` proxy |
| `tsconfig.json` | Base config with references |
| `tsconfig.app.json` | App-level TS config with `@/*` path alias |
| `tsconfig.node.json` | Node-level TS config for vite.config |
| `index.html` | Vite entry HTML |
| `components.json` | shadcn/ui registry configuration |
| `src/main.tsx` | React DOM entry point |
| `src/app.css` | Tailwind CSS 4 import + shadcn theme variables |
| `src/App.tsx` | Chat page composing AI Elements with `useChat` |
| `src/components/ai-elements/` | AI Elements components (installed via CLI) |
| `src/lib/utils.ts` | shadcn utility (`cn` function) |

---

### Task 1: Root Workspace Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `.nvmrc`
- Create: `.gitignore`

**Interfaces:**
- Produces: pnpm workspace root that subsequent tasks install into

- [x] **Step 1: Initialize git repo**

```bash
cd /Users/kirittanna/projects/aiwebdev/course-projects/chatbot
git init
```

- [x] **Step 2: Create `.nvmrc`**

```
22
```

- [x] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [x] **Step 4: Create root `package.json`**

```json
{
  "name": "chatbot",
  "private": true,
  "scripts": {
    "dev": "concurrently --names backend,frontend --prefix-colors blue,green \"pnpm --filter backend dev\" \"pnpm --filter frontend dev\"",
    "build": "pnpm --filter backend build && pnpm --filter frontend build"
  }
}
```

- [x] **Step 5: Create `.gitignore`**

```gitignore
node_modules
dist
.wrangler
.dev.vars
*.local
```

- [x] **Step 6: Install concurrently at workspace root**

```bash
pnpm add -D -w concurrently
```

- [x] **Step 7: Verify workspace structure**

```bash
pnpm ls --depth 0
```

Expected: shows `concurrently` as a dev dependency.

- [x] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json .nvmrc .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace root"
```

---

### Task 2: Backend — Hono on Cloudflare Workers

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/wrangler.toml`
- Create: `packages/backend/src/index.ts`
- Create: `packages/backend/.dev.vars`

**Interfaces:**
- Consumes: workspace root from Task 1
- Produces: `POST /api/chat` endpoint accepting `{ messages: UIMessage[] }` and returning a `UIMessageStreamResponse`

- [x] **Step 1: Create `packages/backend/` directory**

```bash
mkdir -p packages/backend/src
```

- [x] **Step 2: Create `packages/backend/package.json`**

```json
{
  "name": "backend",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run --outdir dist",
    "deploy": "wrangler deploy"
  }
}
```

- [x] **Step 3: Install backend dependencies**

```bash
pnpm --filter backend add hono ai @ai-sdk/openai
pnpm --filter backend add -D wrangler @cloudflare/workers-types typescript
```

- [x] **Step 4: Create `packages/backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

- [x] **Step 5: Create `packages/backend/wrangler.toml`**

```toml
name = "chatbot-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
```

- [x] **Step 6: Create `packages/backend/.dev.vars`**

```
OPENAI_API_KEY=sk-your-key-here
```

- [x] **Step 7: Create `packages/backend/src/index.ts`**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { convertToModelMessages, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

type Bindings = {
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["POST"],
    allowHeaders: ["Content-Type"],
  })
);

app.post("/api/chat", async (c) => {
  const openai = createOpenAI({ apiKey: c.env.OPENAI_API_KEY });
  const { messages } = await c.req.json();

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
});

export default app;
```

- [x] **Step 8: Verify backend compiles**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 9: Commit**

```bash
git add packages/backend
git commit -m "feat: add Hono backend with /api/chat streaming route"
```

---

### Task 3: Frontend — React + Vite + TailwindCSS 4 + shadcn/ui

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/tsconfig.app.json`
- Create: `packages/frontend/tsconfig.node.json`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/app.css`
- Create: `packages/frontend/src/App.tsx` (placeholder)
- Create: `packages/frontend/src/lib/utils.ts`
- Create: `packages/frontend/components.json`

**Interfaces:**
- Consumes: workspace root from Task 1
- Produces: Vite dev server on port 5173 with `/api` proxy to port 8787, shadcn/ui initialized, Tailwind CSS 4 configured

- [x] **Step 1: Create frontend directory structure**

```bash
mkdir -p packages/frontend/src/lib packages/frontend/src/components/ui packages/frontend/public
```

- [x] **Step 2: Create `packages/frontend/package.json`**

```json
{
  "name": "frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

- [x] **Step 3: Install frontend dependencies**

```bash
pnpm --filter frontend add react react-dom @ai-sdk/react ai
pnpm --filter frontend add -D @vitejs/plugin-react vite typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite
```

- [x] **Step 4: Install shadcn/ui utilities**

shadcn/ui components depend on `clsx`, `tailwind-merge`, and `class-variance-authority`:

```bash
pnpm --filter frontend add clsx tailwind-merge class-variance-authority
```

- [x] **Step 5: Create `packages/frontend/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- [x] **Step 6: Create `packages/frontend/tsconfig.app.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [x] **Step 7: Create `packages/frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [x] **Step 8: Create `packages/frontend/vite.config.ts`**

```typescript
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
```

- [x] **Step 9: Create `packages/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chatbot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 10: Create `packages/frontend/src/app.css`**

```css
@import "tailwindcss";
```

- [x] **Step 11: Create `packages/frontend/src/lib/utils.ts`**

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [x] **Step 12: Create `packages/frontend/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [x] **Step 13: Create placeholder `packages/frontend/src/App.tsx`**

```tsx
export default function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">Chatbot</h1>
    </div>
  );
}
```

- [x] **Step 14: Create `packages/frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "tailwind": {
    "config": "",
    "css": "src/app.css",
    "baseColor": "neutral",
    "cssVariables": true
  }
}
```

- [x] **Step 15: Verify frontend compiles and starts**

```bash
cd packages/frontend && npx tsc -b && npx vite --host --port 5173 &
sleep 3
curl -s http://localhost:5173 | head -5
kill %1
```

Expected: HTML with `<div id="root">` returned.

- [x] **Step 16: Commit**

```bash
git add packages/frontend
git commit -m "feat: add React + Vite + TailwindCSS 4 frontend with shadcn/ui"
```

---

### Task 4: Install AI Elements and Build Chat UI

**Files:**
- Create (via CLI): `packages/frontend/src/components/ai-elements/conversation.tsx`
- Create (via CLI): `packages/frontend/src/components/ai-elements/message.tsx`
- Create (via CLI): `packages/frontend/src/components/ai-elements/prompt-input.tsx`
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useChat` from `@ai-sdk/react`, `DefaultChatTransport` from `ai`, AI Elements components from `@/components/ai-elements/`
- Consumes: Backend `POST /api/chat` endpoint (proxied via Vite)
- Produces: Complete chat UI with streaming message display

- [x] **Step 1: Install AI Elements components**

Run from the frontend package directory:

```bash
cd packages/frontend
pnpm dlx ai-elements@latest add conversation message prompt-input
```

This downloads component source into `src/components/ai-elements/`. If prompted for configuration, accept defaults.

If the CLI asks about missing shadcn dependencies, allow it to install them.

- [x] **Step 2: Verify AI Elements files were created**

```bash
ls packages/frontend/src/components/ai-elements/
```

Expected: `conversation.tsx`, `message.tsx`, `prompt-input.tsx` (and possibly sub-files).

- [x] **Step 3: Update `packages/frontend/src/app.css` with shadcn theme**

After AI Elements install, `app.css` may have been updated by the CLI. If not, ensure it has the Tailwind import and any shadcn theme variables the components need. The AI Elements CLI typically handles this. Verify:

```bash
head -20 packages/frontend/src/app.css
```

If it only has `@import "tailwindcss";`, that is fine — the AI Elements components use Tailwind utility classes and the shadcn theming system will have been configured by the CLI.

- [x] **Step 4: Replace `packages/frontend/src/App.tsx` with chat UI**

```tsx
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

export default function App() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const handleSubmit = (message: { text: string }) => {
    sendMessage({ text: message.text });
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Chatbot</h1>
      </header>

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, i) =>
                  part.type === "text" ? (
                    <MessageResponse key={i}>{part.text}</MessageResponse>
                  ) : null
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>

      <PromptInputProvider>
        <PromptInput onSubmit={handleSubmit} className="border-t p-4">
          <PromptInputBody>
            <PromptInputTextarea placeholder="Type a message..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  );
}
```

- [x] **Step 5: Verify frontend compiles**

```bash
cd packages/frontend && npx tsc -b
```

Expected: no errors. If there are type errors from AI Elements components (they may expect additional shadcn dependencies), install them:

```bash
pnpm --filter frontend add lucide-react
```

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src
git commit -m "feat: add chat UI with AI Elements conversation, message, and prompt-input"
```

---

### Task 5: Integration Test — Full Stack Dev Run

**Files:**
- No new files created
- May modify: `packages/backend/src/index.ts` (if CORS or routing issues arise)

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified working dev setup with `pnpm dev`

- [x] **Step 1: Set a real OpenAI API key in `.dev.vars`**

Edit `packages/backend/.dev.vars` and replace `sk-your-key-here` with a valid OpenAI API key.

- [x] **Step 2: Start the full dev environment**

From the workspace root:

```bash
pnpm dev
```

Expected: Two processes start:
- `[backend]` — wrangler dev on port 8787
- `[frontend]` — vite on port 5173

- [x] **Step 3: Test the backend directly**

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Say hello in one sentence."}]}]}'
```

Expected: streamed text response from GPT-4o-mini.

- [x] **Step 4: Test the frontend proxy**

```bash
curl -X POST http://localhost:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Say hello in one sentence."}]}]}'
```

Expected: same streamed response, confirming the Vite proxy works.

- [x] **Step 5: Open browser and test the chat UI**

Open `http://localhost:5173` in a browser. Type a message and send. Verify:
- Message appears in the conversation as "user"
- Assistant response streams in progressively
- Submit button reflects streaming status
- Multiple messages maintain conversation history

- [x] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify full-stack chat integration"
```
