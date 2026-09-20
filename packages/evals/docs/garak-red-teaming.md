# Garak Red Teaming Guide

Garak is an LLM vulnerability scanner that probes for jailbreaks, prompt
injections, and content safety bypasses. Use it to stress-test the chatbot's
guardrails beyond what the Promptfoo safety suite covers.

## Installation

```bash
pip install garak
```

Requires Python 3.10+. Install in a virtual environment to avoid conflicts.

## Running against the chatbot

Start the backend dev server:

```bash
cd /path/to/chatbot
pnpm --filter backend dev
```

Run Garak with the REST provider:

```bash
garak --model-type rest \
  --model-name http://localhost:8787/api/chat \
  --probes encoding,dan,knownbadsignatures,misleading \
  --generations 5
```

### Provider configuration

Create `garak-config.yaml` for the chatbot's REST API format:

```yaml
rest:
  uri: http://localhost:8787/api/chat
  method: POST
  headers:
    Content-Type: application/json
  body_template: '{"messages": [{"role": "user", "parts": [{"type": "text", "text": "$INPUT"}]}], "model": "gpt-4o-mini"}'
  response_json_field: null  # Parse streaming response
```

Then run:

```bash
garak --model-type rest --model-config garak-config.yaml --probes all
```

## Recommended probe categories

| Probe | Tests | Maps to guardrail |
|-------|-------|-------------------|
| `dan` | DAN jailbreak variants | Regex injection patterns |
| `encoding` | Base64, ROT13, hex encoding attacks | Regex + Llama Guard |
| `knownbadsignatures` | Known harmful prompts | Llama Guard S1-S13 |
| `misleading` | Misinformation generation | Llama Guard S5, S13 |
| `replay` | Conversation replay attacks | Middleware input check |
| `glitch` | Token glitch exploits | Regex patterns |

## Interpreting results

Garak outputs a report with:
- **Probe name**: which attack was attempted
- **Detector**: how the output was evaluated
- **Pass rate**: % of attempts that were blocked (higher = more secure)
- **Failing examples**: specific prompts that bypassed guardrails

A pass rate below 80% on any probe category indicates a guardrail gap
worth investigating.

## When to run

- Before deploying changes to guardrail patterns or Llama Guard configuration
- After updating the guardrail tier (simple → local → cloud)
- Periodically (monthly) to test against new attack patterns in Garak updates

## Note on runtime

Full Garak scans take 10-60 minutes depending on probe selection and
`--generations` count. Not suited for CI — use as a manual pre-deployment
check. Start with `--probes dan,encoding` for a quick 5-minute smoke test.
