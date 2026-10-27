# Design

## Context

See proposal.md. The lesson-to-slice mapping is design §1 of `course-build-along-features`, combined with ai-web.dev `chatbot-build-along` design §4 for the features that already existed (scaffold, chat route, streaming, telemetry, tools, skills, sandbox, guardrails, evals, deploy).

## Goals / Non-Goals

**Goals:**
- Every tag installs, typechecks and builds.
- No tag contains code from a later lesson.
- `lesson-20` matches `main`, excluding project docs.

**Non-Goals:**
- Rewriting `main`.
- Per-lesson project docs (`openspec/`, `AGENTS.md`) on tags.
- Making tags runnable without the learner's own keys.

## Decisions

### 1. Rebuild forward from the final code

Each lesson commit is built by taking the final versions of that lesson's files and removing everything a later lesson adds. It is not built by cherry-picking `main`'s history. The final tree is the fixed target, so every step is checked against it.

*Alternative:* tag `main`'s existing commits. Rejected: the shapes differ from what later lessons build on, so a learner's checkout would later be rewritten underneath them.

### 2. Project docs stay off the tags

`openspec/` and `AGENTS.md` describe the finished app, and on an early tag they'd describe code the learner doesn't have yet. They live only on `main`. The done check is:

```bash
git diff --stat lesson-20 main -- . ':!openspec' ':!AGENTS.md'
```

It must print nothing. `.github/` CI *is* part of the tags, from lesson 18 (Evals), where the eval gate is taught. The one exception is the tag-check workflow (task 6.2, `.github/workflows/lesson-tags.yml`): it checks the tags themselves, so it lives on `main` only and is excluded from the comparison too:

```bash
git diff --stat lesson-20 main -- . ':!openspec' ':!AGENTS.md' ':!.github/workflows/lesson-tags.yml'
```

The READMEs are part of the tags and are trimmed per lesson, so a tag never documents code it doesn't have. `.dev.vars.example` lists only what that tag reads.

*Alternative:* evolve `AGENTS.md` per lesson. Rejected: it doubles the authoring work for a file learners don't read in the lessons.

### 3. Tags point at the `course` branch

Learners clone the default branch (`main`) and run `git checkout lesson-NN`; the tag carries them onto `course`. Lesson commands therefore never mention the branch.

### 4. Migrations are fixed when they first appear

Learners apply migrations by filename, and `lesson-20` must match `main`, so a migration file never changes between tags. Two of them therefore carry a column a later lesson uses:
- `0001_bug_reports.sql` (lesson 16) already has `bug_reports.chat_id`, which links a run to its chat from lesson 19.
- `0002_chats.sql` (lesson 19) already has `chats.token_total`, which the token cap uses from lesson 20.

The lessons say so where the column first appears. The redaction eval case lands at lesson 18 with the suites, not at 17 with the guardrails.

### 5. Cross-repo pins

Lessons 13–20 also name an mcp-server tag (`lesson-13` until lesson 16, then `lesson-16`). The chatbot code at each tag must work against that pinned server version. In particular, the chatbot at `lesson-13`–`lesson-15` must not send `external_id`, because the server doesn't accept it before `lesson-16`.

## As built

- **How:** snapshots were stripped backwards from `main` (20 → 03) in a separate worktree, then replayed onto `4d3375d` with `git commit-tree`, reusing each snapshot's tree exactly. Each tag's lockfile was derived from the next one with `pnpm install --lockfile-only`, so dependency versions never drift between tags.
- **Generated files:** the backend README, `.dev.vars.example` and `wrangler.jsonc` were rendered per lesson from one annotated source each; the lesson-20 render is byte-identical to `main`.
- **Checks per tag:** frozen install, `pnpm typecheck`, build, backend tests; a marker table (25 features) present exactly from its lesson on; no unreachable frontend files or unimported dependencies; no `gemma4` in a production build.
- **Boundary decisions:**
  - Access identity (`auth/access.ts`, `jose`), the custom domain and the deploy scripts arrive at 19, per the feature map. Before 19 the middleware sets `userId` to `null`, so lesson 11's traces carry sessions but not users until 19.
  - `ISSUE_TRACKER_URL` and `getMcpServers(env)` arrive with MCP at 13, not with the workflow at 16 as in `main`'s history.
  - The Team Assistant persona text (and the empty-state copy from 10) lists all four abilities from 09, as written in history; prompt versions are `@1` at 09–12, `@2` at 13–17, `@3` at 18 and `@4` at 19.
  - Lesson 04's chat page (plain list and form) and lesson 03's scaffold page are new code; `main` never had them. Lesson 05 brings in AI Elements.
  - Lesson 07's model picker offers one model (GPT-6 Luna); Ollama joins at 08.
  - `pnpm-workspace.yaml` is the same on every tag (build permissions for packages a tag may not install are harmless).

## Risks / Trade-offs

- [The rebuild is long, manual work] → do it in groups of lessons, with CI over every tag as the safety net.
- [Someone pushes to `course` by hand, so a tag no longer matches its lesson] → tags are immutable once published. Fixes go in as `lesson-NN.1` follow-up tags, and the lesson frontmatter is updated to match.
- [An early tag accidentally contains a secret] → the same `.dev.vars` checks as `main` run over every tag in CI.

## Migration Plan

Create `course`, build and tag the commits group by group, push the branch and tags, then enable the tag CI. Rollback: delete the branch and tags. Nothing else depends on them until ai-web.dev publishes the lessons.
