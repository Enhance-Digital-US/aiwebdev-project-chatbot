# Cloudflare Workers Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the chatbot to production as a single Cloudflare Worker at `https://chatbot.course-projects.ai-web.dev`, first without auth, then with a Clerk production instance.

**Architecture:** One Worker (`chatbot`, in `packages/backend`) serves the Vite SPA from Workers Static Assets and runs the Hono app only for `/api/*`. The hostname is attached as a Workers Custom Domain, which auto-creates DNS and a per-host certificate. Clerk session tokens are verified against an explicit `azp` allow-list read from the `CLERK_AUTHORIZED_PARTIES` var.

**Tech Stack:** Cloudflare Workers + Static Assets, Wrangler 4.112, Hono, AI SDK v7, Vite 8 / React 19, Clerk (`@clerk/backend`, `@clerk/react`), Vitest (new, backend unit tests), bash + curl (smoke test).

**Spec:** `docs/superpowers/specs/2026-10-07-workers-deployment-design.md` (decisions D1–D10, account facts)

## Global Constraints

- Production hostname is exactly `chatbot.course-projects.ai-web.dev` (zone `ai-web.dev`).
- Cloudflare account: Enhance Digital LLC, `9dff37a609d16c31de78f32f94783041`. Confirm with `npx wrangler whoami` before any deploy.
- Worker name: `chatbot`.
- Node 22 (`.nvmrc`); pnpm `12.6.0` (root `packageManager`).
- Wrangler is pinned at `4.112.0`. `compatibility_date` must stay `<= 2026-07-21` unless Wrangler is upgraded (`wrangler dev` refuses newer dates).
- Run Wrangler from `packages/backend` via `npx wrangler …`, which resolves the local pinned binary. Never use a global or `@latest` wrangler.
- Deploy with `pnpm run deploy` from the repo root. **Never** `pnpm deploy`, which is pnpm's built-in workspace-deploy command.
- Secrets go in only via `npx wrangler secret put <NAME>` (interactive prompt). Never pass secret values as CLI arguments, never echo them, never commit them.
- `VITE_CLERK_PUBLISHABLE_KEY` is inlined at **build time**. Setting it as a Worker secret has no effect on the frontend.
- First production deploy ships **without Clerk** (spec D5): no `CLERK_SECRET_KEY` secret and no frontend `.env.production` until Task 7.

## Review Focus

1. **Malformed `CLERK_AUTHORIZED_PARTIES`** (trailing slash, spaces, missing scheme, path). Expect it to be normalized to bare origins, or to fail loudly. It must never silently make every user anonymous. Pinned by the Task 3 unit tests.
2. **Site visited before DNS/certificate provisioning finishes.** Expect the smoke test to report "cannot connect" clearly instead of a confusing pass/fail mix. Pinned by Task 2 Step 2 (no-server run) and the Task 5 wait loop.
3. **A production secret is missing** (e.g. `OPENAI_API_KEY`). Expect the deploy check to catch it before users do. Pinned by `--chat` in Task 5 Step 6.
4. **Frontend built without the production `VITE_CLERK_PUBLISHABLE_KEY` (missing, or still a `pk_test_` key) when auth is expected.** Expect detection instead of a silently hidden Sign-in button or a dev-instance banner. Pinned by `--expect-clerk`, which fails in Task 2 Step 4 and passes in Task 7 Step 8.
5. **A user reaches the app via `chatbot.enhancedigital.workers.dev` after auth is on.** That origin is not in the allow-list, so they would be silently anonymous. Pinned by Task 6, which disables `workers.dev` and verifies it no longer serves the app.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `scripts/smoke-test.sh` | Create | Black-box checks of a running deployment (assets, SPA fallback, API routing, optional chat + Clerk-key checks) |
| `package.json` (root) | Modify | Add `smoke` script |
| `packages/backend/src/auth/authorized-parties.ts` | Create | Pure parser: `CLERK_AUTHORIZED_PARTIES` string → normalized origin list |
| `packages/backend/src/auth/authorized-parties.test.ts` | Create | Vitest unit tests for the parser |
| `packages/backend/package.json` | Modify | Add `vitest` devDependency and `test` script |
| `packages/backend/src/middleware.ts` | Modify | Replace `getAuthorizedParties()` stub with the parser |
| `packages/backend/src/types.ts` | Modify | Add `CLERK_AUTHORIZED_PARTIES?: string` binding |
| `packages/backend/wrangler.jsonc` | Modify | `CLERK_AUTHORIZED_PARTIES` var, custom-domain `routes`, later `workers_dev`/`preview_urls: false` |
| `packages/backend/.dev.vars` | Modify (gitignored, local only) | `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` |
| `packages/frontend/.env.production` | Create (Task 7) | Clerk `pk_live_` publishable key (public; committed) |
| `packages/backend/README.md`, `AGENTS.md` | Modify | Deployment docs reflect the decisions |

---

### Task 1: Commit the baseline

The working tree has uncommitted work from two sources: earlier feature work (guardrails, evals, Clerk auth wiring) and the deployment prep listed in the spec's "Already Implemented" section. Commit it so every later task has a clean diff.

**Files:**
- Commit only; no edits.

**Interfaces:**
- Consumes: none
- Produces: clean `git status` on branch `deploy/workers-custom-domain`, with a baseline that builds

- [ ] **Step 1: Create a branch**

```bash
cd /Users/kirittanna/projects/aiwebdev/course-projects/chatbot
git switch -c deploy/workers-custom-domain
```

- [ ] **Step 2: Confirm the eval secrets file is ignored**

Run: `git status --short | grep -F 'packages/evals/.env'`
Expected: **no output**. If it prints anything, stop: `.gitignore` must contain `.env` before continuing.

- [ ] **Step 3: Commit everything as one baseline**

The two sources of changes overlap in the same files (`middleware.ts`, `chat.ts`, `types.ts`, `index.tsx`, `pnpm-lock.yaml`), so splitting them would produce a commit that doesn't install or build. The message is a default; the repo owner may reword it.

```bash
git add -A
git status --short   # verify: no .env, no .dev.vars, no dist/ listed
git commit -m "feat(deploy): baseline for Workers deployment

- Guardrails and eval dataset updates (in-progress work)
- Optional Clerk auth (frontend provider + backend authenticateRequest)
- Serve frontend via Workers Static Assets; /api/* runs Hono (run_worker_first)
- Frontend-first build order, pnpm run deploy, dev assets-dir guard, CI build fix
- GUARDRAIL_TIER/observability vars, LANGFUSE_BASE_URL, dev-only Ollama model
- Deployment design spec and implementation plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Confirm the baseline builds**

Run: `pnpm install --frozen-lockfile && pnpm run build 2>&1 | tail -3`
Expected: install succeeds; output ends with `--dry-run: exiting now.`

- [ ] **Step 5: Verify**

Run: `git status --short`
Expected: empty output.

---

### Task 2: Deployment smoke test script

A black-box check that works against `wrangler dev`, the `workers.dev` URL, and the custom domain. Every later task uses it as its test.

**Files:**
- Create: `scripts/smoke-test.sh`
- Modify: `package.json` (root) `scripts`

**Interfaces:**
- Consumes: a running Worker at `<base-url>`
- Produces: `pnpm run smoke <base-url> [--chat] [--expect-clerk]`. Exit 0 if all checks pass, 1 if any fail, 2 on usage error. Later tasks rely on these exact flags.

- [ ] **Step 1: Create `scripts/smoke-test.sh`**

```bash
#!/usr/bin/env bash
# Smoke test for the single-Worker chatbot (static assets + /api/* Hono app).
# Usage: scripts/smoke-test.sh <base-url> [--chat] [--expect-clerk]
#   --chat          also send one real chat message (spends OpenAI tokens)
#   --expect-clerk  fail unless a Clerk *production* publishable key (pk_live_…) is baked into the bundle
set -uo pipefail

BASE="${1:?usage: smoke-test.sh <base-url> [--chat] [--expect-clerk]}"
BASE="${BASE%/}"
shift
CHAT=0
EXPECT_CLERK=0
for arg in "$@"; do
  case "$arg" in
    --chat) CHAT=1 ;;
    --expect-clerk) EXPECT_CLERK=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }

# Prints "<status> <content-type>"; status is 000 on DNS/TLS/connection failure.
probe() { curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 15 "$@" || true; }

root=$(probe "$BASE/")
if [[ "$root" == 000* ]]; then
  echo "FAIL  cannot connect to $BASE (DNS not propagated or certificate still provisioning?)"
  exit 1
fi
[[ "$root" == "200 text/html"* ]] && pass "/ serves HTML" || fail "/ -> $root (want 200 text/html)"

deep=$(probe "$BASE/some/deep/route")
[[ "$deep" == "200 text/html"* ]] && pass "SPA fallback for client routes" || fail "/some/deep/route -> $deep (want 200 text/html)"

html=$(curl -s --max-time 15 "$BASE/")
entry=$(grep -oE '/assets/index-[^"]+\.js' <<<"$html" | head -1)
if [[ -z "$entry" ]]; then
  fail "no /assets/index-*.js entry script in index.html"
else
  asset=$(probe "$BASE$entry")
  [[ "$asset" == "200 "*javascript* ]] && pass "entry bundle $entry" || fail "$entry -> $asset (want 200 javascript)"
fi

api_get=$(probe "$BASE/api/chat")
[[ "$api_get" == 404* && "$api_get" != *text/html* ]] && pass "GET /api/chat reaches Hono (404, not SPA HTML)" || fail "GET /api/chat -> $api_get (want 404 non-HTML)"

bad=$(curl -s -w '\n%{http_code}' --max-time 15 -X POST -H 'content-type: application/json' \
  -d '{"messages":[],"model":"does-not-exist"}' "$BASE/api/chat")
[[ "$(tail -n1 <<<"$bad")" == 400 && "$bad" == *"Unknown model"* ]] && pass "unknown model -> 400" || fail "unknown model -> $(tail -n1 <<<"$bad") (want 400 Unknown model)"

if (( CHAT )); then
  stream=$(curl -s -N --max-time 60 -X POST -H 'content-type: application/json' \
    -d '{"id":"smoke-test","messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Reply with the single word: pong"}]}]}' \
    "$BASE/api/chat")
  [[ "$stream" == *'"type":"finish"'* ]] && pass "chat stream completes" || fail "chat stream did not finish (secrets set? first 300 chars: ${stream:0:300})"
fi

if (( EXPECT_CLERK )); then
  # Require key characters after the prefix: Clerk's own code contains bare "pk_live_"/"pk_test_" literals.
  if [[ -n "$entry" ]] && curl -s --max-time 15 "$BASE$entry" | grep -qE 'pk_live_[A-Za-z0-9]{8,}'; then
    pass "Clerk production publishable key baked into bundle"
  else
    fail "no pk_live_ Clerk key in $entry (was VITE_CLERK_PUBLISHABLE_KEY set in .env.production at build time?)"
  fi
fi

echo
(( FAILS == 0 )) && echo "All checks passed." || echo "$FAILS check(s) failed."
exit $(( FAILS > 0 ))
```

Then: `chmod +x scripts/smoke-test.sh`

Add to root `package.json` `scripts` (after `"deploy"`):

```json
"smoke": "bash scripts/smoke-test.sh"
```

- [ ] **Step 2: Run against nothing. It must fail cleanly (Review Focus #2)**

Run: `pnpm run smoke http://localhost:8799; echo "exit=$?"`
Expected:
```
FAIL  cannot connect to http://localhost:8799 (DNS not propagated or certificate still provisioning?)
exit=1
```

- [ ] **Step 3: Run against local `wrangler dev`. It must pass**

```bash
pnpm run build
cd packages/backend && npx wrangler dev --port 8799 &
sleep 10
cd /Users/kirittanna/projects/aiwebdev/course-projects/chatbot
pnpm run smoke http://localhost:8799 --chat; echo "exit=$?"
```
Expected: 6 `PASS` lines (`/ serves HTML`, `SPA fallback…`, `entry bundle…`, `GET /api/chat reaches Hono…`, `unknown model -> 400`, `chat stream completes`), then `All checks passed.` and `exit=0`.

- [ ] **Step 4: Confirm `--expect-clerk` fails on a build with no key (Review Focus #4)**

Run: `pnpm run smoke http://localhost:8799 --expect-clerk; echo "exit=$?"`
Expected: `FAIL  no pk_live_ Clerk key in /assets/index-….js …` and `exit=1`. (No `packages/frontend/.env*` with a key exists yet. The bundle still contains Clerk's own bare `"pk_live_"` literals, and this step proves they do not cause a false pass.)

Then stop the dev server: `pkill -f "wrangler dev --port 8799"`

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-test.sh package.json
git commit -m "test(deploy): add smoke-test script for local and deployed Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Clerk `authorizedParties` allow-list

Replaces the `getAuthorizedParties()` stub in `packages/backend/src/middleware.ts`, which returns `[]` and so skips the `azp` check, with a tested parser over a config var (spec D7).

**Files:**
- Create: `packages/backend/src/auth/authorized-parties.ts`
- Test: `packages/backend/src/auth/authorized-parties.test.ts`
- Modify: `packages/backend/package.json`, `packages/backend/src/middleware.ts`, `packages/backend/src/types.ts`, `packages/backend/wrangler.jsonc`, `packages/backend/.dev.vars` (local only), `packages/backend/README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: `AppEnv["Bindings"]` from `packages/backend/src/types.ts`
- Produces: `parseAuthorizedParties(value: string | undefined): string[]` exported from `packages/backend/src/auth/authorized-parties.ts`; env binding `CLERK_AUTHORIZED_PARTIES?: string`

- [ ] **Step 1: Add Vitest**

```bash
pnpm --filter backend add -D vitest@^5.0.3
```

Add to `packages/backend/package.json` `scripts`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test** — `packages/backend/src/auth/authorized-parties.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseAuthorizedParties } from "./authorized-parties";

describe("parseAuthorizedParties", () => {
  it("returns [] when unset or blank", () => {
    expect(parseAuthorizedParties(undefined)).toEqual([]);
    expect(parseAuthorizedParties("")).toEqual([]);
    expect(parseAuthorizedParties(" , ,")).toEqual([]);
  });

  it("parses a single origin", () => {
    expect(parseAuthorizedParties("https://chatbot.course-projects.ai-web.dev")).toEqual([
      "https://chatbot.course-projects.ai-web.dev",
    ]);
  });

  it("splits on commas and trims whitespace", () => {
    expect(
      parseAuthorizedParties(" https://chatbot.course-projects.ai-web.dev , http://localhost:5173 ")
    ).toEqual(["https://chatbot.course-projects.ai-web.dev", "http://localhost:5173"]);
  });

  it("normalizes trailing slashes, paths, and host casing to the bare origin", () => {
    expect(parseAuthorizedParties("https://Chatbot.Course-Projects.ai-web.dev/")).toEqual([
      "https://chatbot.course-projects.ai-web.dev",
    ]);
    expect(parseAuthorizedParties("http://localhost:5173/some/path")).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("drops default ports and de-duplicates", () => {
    expect(
      parseAuthorizedParties("https://a.example:443,https://a.example,https://a.example/")
    ).toEqual(["https://a.example"]);
  });

  it("throws on entries that are not absolute http(s) URLs", () => {
    expect(() => parseAuthorizedParties("chatbot.course-projects.ai-web.dev")).toThrow();
    expect(() => parseAuthorizedParties("mailto:someone@example.com")).toThrow(
      /not an http\(s\) origin/
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter backend test`
Expected: FAIL. The suite errors because `./authorized-parties` cannot be resolved.

- [ ] **Step 4: Write the implementation** — `packages/backend/src/auth/authorized-parties.ts`

```ts
/**
 * Parse CLERK_AUTHORIZED_PARTIES (comma-separated origins) into the list Clerk
 * checks the session token's `azp` claim against.
 *
 * Entries are normalized with `new URL(entry).origin`, so trailing slashes,
 * paths, and host casing don't cause silent mismatches. An invalid entry
 * throws: a misconfigured allow-list should fail loudly, not quietly turn
 * every user anonymous. Unset/empty returns [] (Clerk skips the azp check).
 */
export function parseAuthorizedParties(value: string | undefined): string[] {
  if (!value) return [];
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const { origin } = new URL(entry);
      if (origin === "null") {
        throw new Error(`CLERK_AUTHORIZED_PARTIES: "${entry}" is not an http(s) origin`);
      }
      return origin;
    });
  return [...new Set(origins)];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter backend test`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 6: Add the binding type** in `packages/backend/src/types.ts`, directly after the `CLERK_PUBLISHABLE_KEY` entry:

```ts
    /** Comma-separated origins allowed as the Clerk token `azp` (e.g. "https://chatbot.course-projects.ai-web.dev") */
    CLERK_AUTHORIZED_PARTIES?: string;
```

- [ ] **Step 7: Wire it into the middleware**

Replace all of `packages/backend/src/middleware.ts` with:

```ts
import type { Hono } from "hono";
import { createClerkClient } from "@clerk/backend";
import type { AppEnv } from "./types";
import { initTelemetry } from "./telemetry";
import { parseAuthorizedParties } from "./auth/authorized-parties";

// No CORS middleware: the frontend is served from the same Worker (static
// assets) in production and through the Vite proxy in dev, so /api/* is
// always same-origin. Add `hono/cors` back only if a separate origin needs access.

export function registerMiddleware(app: Hono<AppEnv>) {
  app.use("/api/*", async (c, next) => {
    initTelemetry({
      LANGFUSE_PUBLIC_KEY: c.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: c.env.LANGFUSE_SECRET_KEY,
      LANGFUSE_BASE_URL: c.env.LANGFUSE_BASE_URL,
    });

    c.set("userId", null);

    if (c.env.CLERK_SECRET_KEY) {
      // Outside the try: a malformed allow-list is a deploy bug and must surface as a 500,
      // not be swallowed into "anonymous".
      const authorizedParties = parseAuthorizedParties(c.env.CLERK_AUTHORIZED_PARTIES);
      try {
        const clerk = createClerkClient({
          secretKey: c.env.CLERK_SECRET_KEY,
          publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
        });
        const requestState = await clerk.authenticateRequest(c.req.raw, { authorizedParties });
        if (requestState.isAuthenticated) {
          c.set("userId", requestState.toAuth().userId);
        }
      } catch (err) {
        console.warn("Clerk auth failed, continuing as unauthenticated:", err);
      }
    }

    await next();
  });
}
```

- [ ] **Step 8: Set the production value** in `packages/backend/wrangler.jsonc` `vars`, after `"GUARDRAIL_TIER": "simple"` (add a comma to the preceding line):

```jsonc
    // Clerk token `azp` allow-list (only used when CLERK_SECRET_KEY is set). .dev.vars overrides locally.
    "CLERK_AUTHORIZED_PARTIES": "https://chatbot.course-projects.ai-web.dev"
```

- [ ] **Step 9: Set the local dev value** by appending one line to `packages/backend/.dev.vars`. The file is gitignored; edit it locally and do not commit it.

```
CLERK_AUTHORIZED_PARTIES=http://localhost:5173
```

(Locally the browser origin is the Vite server on `:5173`, even though the Worker sees `:8787` behind the proxy.)

- [ ] **Step 10: Verify build + dry-run + regression smoke**

```bash
cd /Users/kirittanna/projects/aiwebdev/course-projects/chatbot
pnpm run build 2>&1 | grep -E 'CLERK_AUTHORIZED_PARTIES|ASSETS|dry-run'
```
Expected: lines include `env.ASSETS  Assets`, `env.CLERK_AUTHORIZED_PARTIES ("https://chatbot.course-projects.ai-web.dev")`, and `--dry-run: exiting now.`

```bash
cd packages/backend && npx wrangler dev --port 8799 &
sleep 10; cd ../.. && pnpm run smoke http://localhost:8799; pkill -f "wrangler dev --port 8799"
```
Expected: `All checks passed.`

- [ ] **Step 11: Update docs**

In `packages/backend/README.md`, Step 4 ("Configure frontend auth"), replace the whole blockquote that starts with `> **Open decision:**` with:

```markdown
> **Token origin check:** `CLERK_AUTHORIZED_PARTIES` (comma-separated origins) is passed to Clerk as `authorizedParties`, so tokens minted for other sites on the same Clerk instance are rejected. Production value lives in `wrangler.jsonc`; set `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` in `.dev.vars` for local dev (the Vite proxy means the browser origin is `:5173`, not `:8787`). A malformed entry makes `/api/*` return 500 rather than silently de-authenticating users.
>
> Auth currently only **tags** traces; it does not gate `/api/chat`. Anyone with the URL can use the chatbot (and your OpenAI credits).
```

In `AGENTS.md`, Environment Variables table, add after the `CLERK_PUBLISHABLE_KEY` row:

```markdown
| `CLERK_AUTHORIZED_PARTIES` | No | Comma-separated origins allowed as Clerk token `azp` (prod in `wrangler.jsonc`, `http://localhost:5173` in `.dev.vars`) |
```

- [ ] **Step 12: Commit**

```bash
git add packages/backend/src/auth packages/backend/src/middleware.ts packages/backend/src/types.ts \
        packages/backend/package.json packages/backend/wrangler.jsonc packages/backend/README.md \
        AGENTS.md pnpm-lock.yaml
git commit -m "feat(auth): verify Clerk token azp against CLERK_AUTHORIZED_PARTIES allow-list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Attach the custom domain in config

**Files:**
- Modify: `packages/backend/wrangler.jsonc`, `packages/backend/README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: Worker name `chatbot` (already in `wrangler.jsonc`)
- Produces: `routes` entry `{ "pattern": "chatbot.course-projects.ai-web.dev", "custom_domain": true }`, which Task 5's deploy uses

- [ ] **Step 1: Add the route** to `packages/backend/wrangler.jsonc`, directly after the `"compatibility_flags"` line:

```jsonc

  // Workers Custom Domain: wrangler deploy creates the DNS record and a per-host
  // certificate (covers this 2-level subdomain; no Advanced Certificate Manager needed).
  "routes": [
    { "pattern": "chatbot.course-projects.ai-web.dev", "custom_domain": true }
  ],
  // Keep workers.dev on as a fallback until the custom domain is verified (spec D8).
  // Explicit, because Wrangler's default may change once routes are configured. Task 6 flips this.
  "workers_dev": true,
```

- [ ] **Step 2: Validate the config**

Run: `cd /Users/kirittanna/projects/aiwebdev/course-projects/chatbot && pnpm run build 2>&1 | tail -12`
Expected: no `✘ [ERROR]`; ends with `--dry-run: exiting now.`

- [ ] **Step 3: Update docs**

In `packages/backend/README.md`, under `### Step 5: Deploy`, replace the fenced block that shows `Uploaded chatbot (x.xx sec)` with:

````markdown
```
Uploaded chatbot (x.xx sec)
Deployed chatbot triggers (x.xx sec)
  https://chatbot.enhancedigital.workers.dev
  chatbot.course-projects.ai-web.dev (custom domain)
```

The first deploy creates the DNS record and certificate for `chatbot.course-projects.ai-web.dev`; allow a few minutes before the hostname serves over HTTPS. Verify with `pnpm run smoke https://chatbot.course-projects.ai-web.dev --chat`.

Other course projects follow the same pattern: each Worker gets its own `<project>.course-projects.ai-web.dev` custom domain, so each is a separate origin (cookies, storage and auth sessions stay isolated).
````

In `AGENTS.md`, replace `deployed to Cloudflare as a single Worker (Hono API + frontend via Workers Static Assets).` with:

```markdown
deployed to Cloudflare as a single Worker (Hono API + frontend via Workers Static Assets) at `https://chatbot.course-projects.ai-web.dev` (Workers Custom Domain).
```

and add a row to the Commands table after the `pnpm run deploy` row:

```markdown
| `pnpm run smoke <url> [--chat] [--expect-clerk]` (root) | Black-box checks against a running Worker (local or deployed) |
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/wrangler.jsonc packages/backend/README.md AGENTS.md
git commit -m "feat(deploy): attach chatbot.course-projects.ai-web.dev as Workers Custom Domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: First production deploy (auth off)

An operational task: no code changes. **A human must approve the deploy**, because it creates public DNS and a public URL.

**Files:** none

**Interfaces:**
- Consumes: Tasks 2–4 merged into the working branch
- Produces: live `https://chatbot.course-projects.ai-web.dev` serving the app, with chat working

- [ ] **Step 1: Confirm account**

Run: `cd packages/backend && npx wrangler whoami`
Expected: account `Enhance Digital LLC` / `9dff37a609d16c31de78f32f94783041`.

- [ ] **Step 2: Confirm the build carries no Clerk key (spec D5)**

Run: `ls packages/frontend/.env* 2>/dev/null` (from repo root)
Expected: only `packages/frontend/.env.example`. If `.env` or `.env.production` holds a key, move it aside for this deploy.

- [ ] **Step 3: Set required secrets** (interactive; paste each value at the prompt)

```bash
cd packages/backend
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put LANGFUSE_PUBLIC_KEY
npx wrangler secret put LANGFUSE_SECRET_KEY
npx wrangler secret put E2B_API_KEY
```

If the Worker does not exist yet, Wrangler asks to create it; answer yes. Do **not** set `CLERK_SECRET_KEY` yet.

Run: `npx wrangler secret list`
Expected: exactly those 4 names.

- [ ] **Step 4: Deploy**

Run (repo root): `pnpm run deploy`
Expected: output ends with the triggers list containing `chatbot.course-projects.ai-web.dev (custom domain)` and `https://chatbot.enhancedigital.workers.dev`.

- [ ] **Step 5: Wait for DNS + certificate** (Review Focus #2). Polls for up to 10 minutes:

```bash
for i in $(seq 1 40); do
  curl -sf -o /dev/null https://chatbot.course-projects.ai-web.dev/ && { echo "up after $((i*15))s"; break; }
  sleep 15
done
```
Expected: `up after …s`. If it never comes up, check Cloudflare dashboard → Workers → `chatbot` → Settings → Domains & Routes, and SSL/TLS → Edge Certificates for a pending certificate.

- [ ] **Step 6: Smoke both URLs** (Review Focus #3)

```bash
pnpm run smoke https://chatbot.course-projects.ai-web.dev --chat
pnpm run smoke https://chatbot.enhancedigital.workers.dev
```
Expected: `All checks passed.` for both. If `chat stream completes` fails, run `cd packages/backend && npx wrangler tail --status error` in another terminal, re-run the smoke test, and read the error (usually a missing secret).

- [ ] **Step 7: Check telemetry**

Open the Langfuse dashboard (US region). Expected: a trace for the smoke-test chat with session id `smoke-test` and no user id.

- [ ] **Step 8: Rollback reference (only if needed)**

`cd packages/backend && npx wrangler rollback` returns to the previous version. There is none on a first deploy, so instead fix forward and redeploy with `pnpm run deploy`.

---

### Task 6: Make the custom domain the only origin

Spec D8 and Review Focus #5.

**Files:**
- Modify: `packages/backend/wrangler.jsonc`, `packages/backend/README.md`

**Interfaces:**
- Consumes: verified custom domain from Task 5
- Produces: Worker reachable only at `https://chatbot.course-projects.ai-web.dev`

- [ ] **Step 1: Disable workers.dev and preview URLs.** In `packages/backend/wrangler.jsonc`, replace the two comment lines and `"workers_dev": true,` added in Task 4 with:

```jsonc
  // Single canonical origin: the workers.dev origin is not in CLERK_AUTHORIZED_PARTIES.
  "workers_dev": false,
  "preview_urls": false,
```

- [ ] **Step 2: Deploy**

Run (repo root): `pnpm run deploy`
Expected: the triggers list shows only `chatbot.course-projects.ai-web.dev (custom domain)`. No `workers.dev` URL appears.

- [ ] **Step 3: Verify workers.dev no longer serves the app**

Run: `pnpm run smoke https://chatbot.enhancedigital.workers.dev; echo "exit=$?"`
Expected: `exit=1` (connection failure, or `/` not returning the app's HTML). It must **not** print `All checks passed.`

- [ ] **Step 4: Verify the custom domain still works**

Run: `pnpm run smoke https://chatbot.course-projects.ai-web.dev`
Expected: `All checks passed.`

- [ ] **Step 5: Update README.** In `packages/backend/README.md` Step 5, replace the triggers code block from Task 4 with:

````markdown
```
Uploaded chatbot (x.xx sec)
Deployed chatbot triggers (x.xx sec)
  chatbot.course-projects.ai-web.dev (custom domain)
```

`workers_dev` and `preview_urls` are disabled so the custom domain is the only origin (it is the only one in `CLERK_AUTHORIZED_PARTIES`).
````

- [ ] **Step 6: Commit**

```bash
git add packages/backend/wrangler.jsonc packages/backend/README.md
git commit -m "chore(deploy): disable workers.dev and preview URLs; custom domain is canonical

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Clerk production instance

Spec D5/D6. Partly manual, in the dashboards. **A human must do Steps 1–4**: Clerk dashboard access is required, and the wrangler token cannot write DNS.

**Files:**
- Create: `packages/frontend/.env.production`

**Interfaces:**
- Consumes: live custom domain (Tasks 5–6); `CLERK_AUTHORIZED_PARTIES` wiring (Task 3)
- Produces: signed-in users' Clerk `userId` on Langfuse traces in production

- [ ] **Step 1: Create the production instance.** In the Clerk dashboard for this application, create a **Production** instance and set the domain to `chatbot.course-projects.ai-web.dev` (spec D6). This scopes sessions to this project instead of all `*.ai-web.dev`.

- [ ] **Step 2: Add Clerk's DNS records.** Clerk → Configure → **Domains** lists the CNAME records it needs. Add each one exactly as shown in Cloudflare dashboard → `ai-web.dev` → DNS → Records, with Proxy status **DNS only** (grey cloud). Clerk issues its own certificates for these hosts, and proxying breaks that.

- [ ] **Step 3: Wait for verification.** In Clerk → Domains, wait until every record and the SSL certificates show verified/issued.

- [ ] **Step 4: Social login (only if enabled).** Production instances do not use Clerk's shared OAuth credentials. For each enabled social provider, add your own client ID and secret in Clerk → SSO connections.

- [ ] **Step 5: Bake the publishable key into the frontend build.** Create `packages/frontend/.env.production` with the production key from Clerk → API keys:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_live_<value copied from Clerk dashboard>
```

Publishable keys are public, so committing this file is intended. It is not matched by `.gitignore` (`.env` and `*.local` only).

- [ ] **Step 6: Set backend secrets** (interactive)

```bash
cd packages/backend
npx wrangler secret put CLERK_SECRET_KEY        # sk_live_… from Clerk → API keys
npx wrangler secret put CLERK_PUBLISHABLE_KEY   # same pk_live_… as Step 5
```

- [ ] **Step 7: Deploy**

Run (repo root): `pnpm run deploy`

- [ ] **Step 8: Smoke with the Clerk check** (Review Focus #4)

Run: `pnpm run smoke https://chatbot.course-projects.ai-web.dev --chat --expect-clerk`
Expected: `PASS  Clerk production publishable key baked into bundle` and `All checks passed.` (A `pk_test_` key fails this check on purpose.)

- [ ] **Step 9: Manual sign-in check**

1. Open `https://chatbot.course-projects.ai-web.dev` in a private window. Expected: a **Sign in** button in the header, and no Clerk "development mode" banner.
2. Sign in, then send "hello". Expected: a streamed reply.
3. Langfuse → Traces → newest trace. Expected: `langfuse.user.id` is set to the Clerk user id (`user_…`).
4. In another terminal: `cd packages/backend && npx wrangler tail`. Expected: while sending a message signed-in, no `Clerk auth failed` warnings appear. If one shows an `azp`/authorized-parties error, compare the browser's origin with `CLERK_AUTHORIZED_PARTIES` in `wrangler.jsonc`.

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/.env.production
git commit -m "feat(auth): enable Clerk production instance for chatbot.course-projects.ai-web.dev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After All Tasks

- Merge `deploy/workers-custom-domain` into `main` using superpowers:finishing-a-development-branch.
- Follow-ups (out of scope, see spec): CI deploys / Workers Builds; confirm the eval workflow's `wrangler dev` starts without Cloudflare credentials; decide whether `/api/chat` should require sign-in; a `course-projects.ai-web.dev` index Worker.
