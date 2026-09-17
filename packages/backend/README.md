# Chatbot API Backend

Hono + Cloudflare Workers backend with AI SDK v7, OpenAI and Ollama providers, and Langfuse observability via OpenTelemetry.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Langfuse account](https://cloud.langfuse.com) (US region)

## Local Development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Create `packages/backend/.dev.vars` (gitignored):

```env
OPENAI_API_KEY=sk-proj-your-openai-key
LANGFUSE_PUBLIC_KEY=pk-lf-your-langfuse-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-langfuse-secret-key
```

Get your Langfuse keys from: **Langfuse Dashboard → Settings → API Keys**

### 3. Start the dev server

```bash
pnpm --filter backend dev
```

The API runs at `http://localhost:8787`.

### 4. Test

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hello"}]}]}'
```

After a successful request, check your [Langfuse dashboard](https://us.cloud.langfuse.com) — you should see a trace with:
- Model: `gpt-4o-mini`
- Non-zero input/output token counts
- Prompt and completion content

## Deploy to Cloudflare Workers

### Step 1: Authenticate with Cloudflare

If you haven't already, log in to Cloudflare via Wrangler:

```bash
npx wrangler login
```

This opens a browser window for OAuth. Once authenticated, Wrangler stores your credentials locally.

### Step 2: Set production secrets

Secrets are encrypted and stored by Cloudflare — they're never in your code or config files.

```bash
# Run each command and paste the key value when prompted:

npx wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key

npx wrangler secret put LANGFUSE_PUBLIC_KEY
# Paste your Langfuse public key (pk-lf-...)

npx wrangler secret put LANGFUSE_SECRET_KEY
# Paste your Langfuse secret key (sk-lf-...)
```

To verify secrets are set:

```bash
npx wrangler secret list
```

### Step 3: Review `wrangler.toml`

```toml
name = "chatbot-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
```

Key points:
- **`nodejs_compat`** is required — the OTel packages use Node APIs (`Buffer`, `process.hrtime`) that this flag polyfills in Workers.
- **No `[observability.traces]` section** — Workers native tracing creates a separate trace tree from `@opentelemetry/api`, which would send Langfuse disconnected duplicate traces.

### Step 4: Deploy

```bash
pnpm --filter backend deploy
```

Or directly:

```bash
cd packages/backend
npx wrangler deploy
```

Wrangler outputs the production URL:

```
Published chatbot-api (x.xx sec)
  https://chatbot-api.<your-subdomain>.workers.dev
```

### Step 5: Update frontend CORS origin

After deployment, update the CORS origin in `packages/backend/src/index.ts` to include your production frontend URL:

```typescript
cors({
  origin: ["http://localhost:5173", "https://your-frontend.pages.dev"],
  allowMethods: ["POST"],
  allowHeaders: ["Content-Type"],
})
```

Then redeploy.

### Step 6: Verify in Langfuse

1. Send a request to your production endpoint
2. Open [Langfuse US dashboard](https://us.cloud.langfuse.com)
3. Navigate to **Traces** — you should see a trace for each request
4. Click into a trace to verify:
   - **Model:** `gpt-4o-mini` (or `gemma4:12b` for Ollama route)
   - **Input tokens:** non-zero count
   - **Output tokens:** non-zero count
   - **Prompt/Completion:** visible (unless disabled via `recordInputs`/`recordOutputs`)

## API Routes

| Route | Method | Provider | Model |
|-------|--------|----------|-------|
| `/api/chat` | POST | OpenAI | `gpt-4o-mini` |
| `/api/ollama-chat` | POST | Ollama (local) | `gemma4:12b` |

Both routes accept the AI SDK UI message format and return SSE streams.

## Project Structure

```
packages/backend/
├── src/
│   ├── index.ts        # Hono app, routes, CORS, telemetry middleware
│   └── telemetry.ts    # Langfuse OTLP exporter, provider init, flush
├── .dev.vars           # Local secrets (gitignored)
├── package.json
├── tsconfig.json
└── wrangler.toml       # Cloudflare Workers config
```

## Observability Architecture

```
streamText() → @ai-sdk/otel → BasicTracerProvider → SimpleSpanProcessor
                                                          │
                                                          ▼
                                               LangfuseFetchExporter
                                                    (fetch API)
                                                          │
                                                          ▼
                                    POST https://us.cloud.langfuse.com/api/public/otel/v1/traces
```

- **`@ai-sdk/otel`** auto-instruments all `streamText`/`generateText` calls with `gen_ai.*` semantic convention spans
- **`SimpleSpanProcessor`** exports immediately on span end (no batching timers — correct for serverless)
- **`LangfuseFetchExporter`** uses Workers-native `fetch()` with Basic auth
- **Flush** happens in each route's `onEnd` callback via `waitUntil()` — ensures spans have complete token counts before export

## Disabling Prompt/Completion Logging

By default, prompts and completions are sent to Langfuse. To disable per-call:

```typescript
streamText({
  model: openai("gpt-4o-mini"),
  messages,
  telemetry: {
    functionId: "openai-chat",
    recordInputs: false,
    recordOutputs: false,
  },
});
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No traces in Langfuse | Placeholder or wrong keys in `.dev.vars` | Replace with real keys from Langfuse dashboard |
| `Uncaught [object Array]` in wrangler logs | Flush promise rejection (auth failure) | Already handled by `.catch(() => {})` in `flushTelemetry()` |
| Token counts show 0 | Flush happening before stream completes | Ensure flush is in `onEnd` callback, not post-middleware |
| Two disconnected traces per request | Workers native tracing enabled | Remove `[observability.traces]` from `wrangler.toml` |
| Build error: cannot resolve OTel packages | Missing direct dependencies | Run `pnpm --filter backend add @opentelemetry/resources @opentelemetry/core` |
