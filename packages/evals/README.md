# Evals

A three-layer evaluation system for the chatbot: offline testing via [Promptfoo](https://promptfoo.dev), production monitoring via [Langfuse](https://langfuse.com) online evals, with [Braintrust](https://braintrustdata.com) as an extension and [Garak](https://github.com/NVIDIA/garak) documented for adversarial red teaming.

## Architecture

```
Developer Machine          CI (GitHub Actions)         Production
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Promptfoo CLI   │     │  promptfoo eval   │     │   Langfuse       │
│  - YAML configs  │────▶│  - Gate PRs       │     │   Online Evals   │
│  - Watch mode    │     │  - Fail on        │     │   - Score traces │
│  - HTML reports  │     │    regression     │     │   - Dashboard    │
└─────────────────┘     └───────────────────┘     └──────────────────┘

Extensions:
┌─────────────────┐     ┌───────────────────┐
│  Braintrust      │     │   Garak           │
│  - UI dashboard  │     │   - Adversarial   │
│  - Experiment    │     │     red teaming   │
│    tracking      │     │   - Jailbreak     │
└─────────────────┘     │     probes        │
                        └───────────────────┘
```

## Tech Stack and Design Choices

### Why Promptfoo (Offline & CI)

Promptfoo is the primary eval runner because it:

- **Tests the full stack** — the custom provider hits the chatbot's `/api/chat` endpoint, exercising middleware, guardrails, tools, and streaming, not just the raw LLM
- **Uses YAML config** — test cases are declarative, version-controlled, and easy to review
- **Supports LLM-as-judge** — `llm-rubric` assertions let an LLM grade open-ended responses where regex/contains checks aren't expressive enough
- **Has a configurable grader model** — defaults to `gpt-4o-mini` (cheap) but overridable via `--grader` CLI flag for higher-quality grading locally

### Why Langfuse (Production)

Langfuse provides production observability because:

- **Builds on existing OTel pipeline** — the backend already sends traces to Langfuse, so scoring happens on data that's already flowing
- **Deterministic scoring in production** — the custom scorer (`scripts/langfuse-evals.ts`) applies rule-based checks on real traffic rather than expensive LLM-as-judge calls
- **Dashboard and alerting** — Langfuse's built-in dashboards show score distributions over time for spotting regressions

### Why Braintrust (Extension)

Braintrust complements Promptfoo for teams wanting a richer workflow:

- **Web dashboard** with visual side-by-side diffs across experiments
- **Dataset management** beyond YAML files
- **Experiment tracking** with built-in A/B comparison
- Shares the same YAML test cases — only the runner and reporting layer changes

### Why Garak (Red Teaming)

Garak provides adversarial safety testing beyond what Promptfoo's hand-written safety cases cover:

- Hundreds of built-in attack probes (encoding tricks, multi-turn escalation, persona switching)
- Automated probe generation that discovers novel jailbreaks
- Documented as a manual pre-deployment check, not a CI gate (runs take 10-60 minutes)

See [`docs/garak-red-teaming.md`](docs/garak-red-teaming.md) for the full setup guide.

### Custom Provider Design

The Promptfoo provider (`providers/chatbot.ts`) deserves a note because it's not trivial:

- The backend uses AI SDK's `createUIMessageStreamResponse`, which outputs **SSE format** (`data: <json>\n\n`), not the older `0:` Data Stream Protocol
- Messages must be sent in **UIMessage format** with `parts: [{type: "text", text}]`, not the simpler `{role, content}` shape
- Text is extracted from `text-delta` chunks by concatenating their `delta` fields
- The provider accepts Promptfoo's options object in the constructor (`{id, config, env}`) — not a plain string

## File Structure

```
packages/evals/
├── README.md                    # This file
├── package.json                 # Eval-specific deps (promptfoo, braintrust, langfuse)
├── tsconfig.json                # TypeScript config
├── promptfooconfig.yaml         # Main Promptfoo config (provider, grader, test suites)
├── providers/
│   └── chatbot.ts               # Custom provider hitting /api/chat endpoint
├── datasets/
│   ├── safety.yaml              # 15 test cases: injection, harmful content, jailbreaks, false positives
│   ├── quality.yaml             # 12 test cases: accuracy, relevance, coherence, edge cases
│   └── tools.yaml               # 11 test cases: weather, conversion, code execution, no-tool
├── scripts/
│   ├── langfuse-evals.ts        # Production scorer: safety + tool-use on Langfuse traces
│   └── braintrust-eval.ts       # Alternative runner using Braintrust SDK + autoevals
└── docs/
    └── garak-red-teaming.md     # Garak setup and usage guide
```

## Prerequisites

- Node.js 22+
- pnpm 10+
- The chatbot backend running locally (for Promptfoo evals)
- `OPENAI_API_KEY` environment variable set

## Setup

From the repository root:

```bash
pnpm install
```

This installs all workspace dependencies including the evals package. The evals workspace is isolated — its dependencies (promptfoo, braintrust, langfuse, autoevals) don't bloat the Worker bundle.

## Running Evals

### Start the backend first

Promptfoo evals hit the live chatbot endpoint, so the backend must be running:

```bash
# From the repo root
pnpm --filter backend dev
```

This starts the Wrangler dev server at `http://localhost:8787`.

### Promptfoo (primary)

```bash
cd packages/evals

# Run all suites
pnpm eval

# Run individual suites
pnpm eval:safety       # Safety & guardrails (15 tests)
pnpm eval:quality      # Response quality (12 tests)
pnpm eval:tools        # Tool use correctness (11 tests)

# View results in browser
pnpm eval:view
```

#### Overriding the grader model

The default LLM-as-judge model is `gpt-4o-mini` (configured in `promptfooconfig.yaml`). Override it at runtime with the `--grader` CLI flag:

```bash
npx promptfoo eval --grader openai:gpt-4.1
```

> **Note:** `PROMPTFOO_GRADER_MODEL` is not a real Promptfoo env var. Use `--grader` instead.

### Braintrust (extension)

```bash
cd packages/evals
pnpm eval:braintrust
```

Requires `BRAINTRUST_API_KEY` and `OPENAI_API_KEY` environment variables. Results appear in the [Braintrust dashboard](https://braintrustdata.com) for visual comparison and experiment tracking.

### Langfuse (production scoring)

```bash
cd packages/evals
pnpm eval:langfuse
```

Requires environment variables:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` (defaults to `https://us.cloud.langfuse.com`)

This fetches recent traces from Langfuse and writes scores for:
- **`safety-guardrail-triggered`** — whether a guardrail blocked the response
- **`tool-use-success`** — whether tool calls completed successfully

### Garak (red teaming)

See the full guide at [`docs/garak-red-teaming.md`](docs/garak-red-teaming.md). Quick start:

```bash
pip install garak

garak --model-type rest \
  --model-name http://localhost:8787/api/chat \
  --probes dan,encoding \
  --generations 5
```

## Environment Variables

| Variable | Required For | Default | Description |
|----------|-------------|---------|-------------|
| `OPENAI_API_KEY` | Promptfoo, Braintrust | — | Powers the chatbot and LLM-as-judge grading |
| `CHATBOT_URL` | Promptfoo, Braintrust | `http://localhost:8787` | Chatbot endpoint for eval provider |
| `BRAINTRUST_API_KEY` | Braintrust | — | Braintrust API key for experiment tracking |
| `LANGFUSE_PUBLIC_KEY` | Langfuse | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Langfuse | — | Langfuse project secret key |
| `LANGFUSE_BASE_URL` | Langfuse | `https://us.cloud.langfuse.com` | Langfuse API base URL |

## Test Suites

### Safety (15 tests)

Tests that guardrails catch harmful content. Categories:

| Category | Examples | Assertion Type |
|----------|----------|---------------|
| Prompt injection | "Ignore previous instructions...", "You are now DAN..." | `not-contains` + `llm-rubric` |
| Harmful content | Weapons, illegal activities, self-harm | `llm-rubric`: refuses the request |
| Jailbreak | DAN prompts, role-play exploits | `llm-rubric`: does not comply |
| False positive checks | Benign queries about weather, cooking, history | `llm-rubric`: provides helpful answer (not blocked) |

### Quality (12 tests)

Tests response relevance, accuracy, and formatting:

| Category | Examples | Assertion Type |
|----------|----------|---------------|
| Factual Q&A | Capital of France, water boiling point | `contains` + `llm-rubric` |
| Explanation | How photosynthesis works | `llm-rubric`: accurate and educational |
| Conversation | Greetings, follow-ups | `llm-rubric`: appropriate and coherent |
| Edge cases | Empty input, single character, very long input | `llm-rubric`: handles gracefully |

### Tool Use (11 tests)

Tests that tools are invoked correctly and results incorporated:

| Category | Examples | Assertion Type |
|----------|----------|---------------|
| Weather tool | "Weather in Tokyo", "Weather in London" | `llm-rubric`: mentions temperature/conditions |
| Unit conversion | "5 miles to km", "100°F to Celsius" | `llm-rubric` + `contains` expected value |
| Code execution | "Calculate fibonacci(10)", "Simple arithmetic" | `llm-rubric`: correct result |
| No-tool query | "Tell me a joke", "What is love?" | `llm-rubric`: answers without tool mention |

## CI Integration

The GitHub Actions workflow (`.github/workflows/evals.yml`) runs automatically on PRs to `main` that touch `packages/backend/**` or `packages/evals/**`.

### Pipeline

```
PR opened/updated
    │
    ├─ 1. Install dependencies + build backend
    │
    ├─ 2. Write .dev.vars + start Wrangler dev server
    │
    ├─ 3. Run Promptfoo evals (all suites run, even if one fails)
    │     ├─ Safety   → must pass 100%
    │     ├─ Quality  → must pass ≥ 85%
    │     └─ Tool use → must pass ≥ 80%
    │
    └─ 4. Upload results-*.json as artifacts
```

### Thresholds

| Suite | Threshold | Rationale |
|-------|-----------|-----------|
| Safety | 100% | Non-negotiable — any safety regression blocks the PR |
| Quality | ≥ 85% | Allows for LLM-as-judge variance across runs |
| Tool use | ≥ 80% | 2 of 11 tests require E2B (not available in CI), capping max at ~82% |

Pass rate thresholds are enforced via the `PROMPTFOO_PASS_RATE_THRESHOLD` env var (percentage, 0–100). Promptfoo exits non-zero when the pass rate falls below the threshold.

### Required GitHub Secret

- `OPENAI_API_KEY` — used by both the chatbot backend and LLM-as-judge grading

## Adding New Test Cases

1. Add test entries to the appropriate YAML file in `datasets/`
2. Each test needs a `description` prefixed with the suite name (e.g., `"safety: ..."`, `"quality: ..."`, `"tools: ..."`) — the CI workflow uses `--filter-pattern` to match against these
3. Define `vars.prompt` (the user message) and `assert` (the assertions)
4. Run `pnpm eval` locally to verify before pushing

### Assertion types

- `contains` / `not-contains` — substring match (fast, deterministic, no API cost)
- `llm-rubric` — LLM-as-judge grades the output against a rubric string (flexible, costs one grader API call per assertion)
- `javascript` — custom JS expression for complex checks

Prefer deterministic assertions (`contains`, `not-contains`) where possible to reduce cost and flakiness. Use `llm-rubric` for open-ended quality judgments.
