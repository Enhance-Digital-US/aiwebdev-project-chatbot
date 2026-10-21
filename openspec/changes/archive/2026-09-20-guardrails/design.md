# Guardrails Design

**Date:** 2026-09-20
**Status:** Approved

## Overview

Three-tier runtime guardrails system for the chatbot, integrated via AI SDK Language Model Middleware. Each tier provides input and output safety classification at increasing sophistication, all sharing the same middleware architecture.

## Architecture

AI SDK middleware wraps the model — it intercepts **every** model invocation in the agentic loop (including tool result steps), not just the first call. This means guardrails automatically classify user messages, tool results from MCP servers, and model output at every step.

### Three Tiers

| Tier | Engine | Cost | Use case |
|------|--------|------|----------|
| `simple` | Regex blocklist + OpenAI Moderation API | Free | Quick baseline, demonstrates the pattern |
| `local` | Llama Guard 3 via Ollama | Free (local compute) | Local dev, offline, privacy-sensitive |
| `cloud` | Llama Guard 3 8B via CF Workers AI | ~$0.05/1K checks | Production CF deployment |

Selected via `GUARDRAIL_TIER` environment variable. Set to `none` to disable.

### Streaming Strategy

Sentence-level buffering in `wrapStream`:

1. Per-chunk regex scan (microseconds)
2. Accumulate text until sentence boundary (`.` `?` `!` `\n`)
3. Call safety checker on complete sentence
4. Safe → release to client; unsafe → halt stream
5. Post-stream full check in `flush()` as safety net

### Content Classified

Llama Guard 3 covers 13 MLCommons hazard categories (S1–S13): violent crimes, non-violent crimes, sex crimes, child exploitation, defamation, specialized advice, privacy, intellectual property, indiscriminate weapons, hate, self-harm, sexual content, elections.

**Known gap:** No dedicated prompt injection category. Mitigated by regex-based injection patterns in the input guardrail.

### Telemetry

All guardrail decisions logged to Langfuse via existing OTel pipeline as trace/observation scores.

## Files

| File | Purpose |
|------|---------|
| `src/guardrails/checker.ts` | `SafetyChecker` type, `SafetyResult`, response parser, prompt extractor |
| `src/guardrails/simple.ts` | Tier 1: regex + OpenAI Moderation |
| `src/guardrails/local.ts` | Tier 2: Llama Guard via Ollama |
| `src/guardrails/cloud.ts` | Tier 3: Llama Guard via CF Workers AI |
| `src/guardrails/middleware.ts` | AI SDK middleware with sentence-level streaming |
| `src/guardrails/index.ts` | Factory + re-exports |
| `src/routes/chat.ts` | Wrap model with guardrail middleware |
| `src/types.ts` | Add `AI` and `GUARDRAIL_TIER` bindings |
| `wrangler.toml` | Add `[ai]` binding |

## Environment

```
GUARDRAIL_TIER=local    # .dev.vars (dev)
GUARDRAIL_TIER=cloud    # production
GUARDRAIL_TIER=none     # disable
```
