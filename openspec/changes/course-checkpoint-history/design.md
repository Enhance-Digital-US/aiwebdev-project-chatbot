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

It must print nothing. `.github/` CI *is* part of the tags, from lesson 18 (Evals), where the eval gate is taught.

*Alternative:* evolve `AGENTS.md` per lesson. Rejected: it doubles the authoring work for a file learners don't read in the lessons.

### 3. Tags point at the `course` branch

Learners clone the default branch (`main`) and run `git checkout lesson-NN`; the tag carries them onto `course`. Lesson commands therefore never mention the branch.

### 4. Cross-repo pins

Lessons 13–20 also name an mcp-server tag (`lesson-13` until lesson 16, then `lesson-16`). The chatbot code at each tag must work against that pinned server version. In particular, the chatbot at `lesson-13`–`lesson-15` must not send `external_id`, because the server doesn't accept it before `lesson-16`.

## Risks / Trade-offs

- [The rebuild is long, manual work] → do it in groups of lessons, with CI over every tag as the safety net.
- [Someone pushes to `course` by hand, so a tag no longer matches its lesson] → tags are immutable once published. Fixes go in as `lesson-NN.1` follow-up tags, and the lesson frontmatter is updated to match.
- [An early tag accidentally contains a secret] → the same `.dev.vars` checks as `main` run over every tag in CI.

## Migration Plan

Create `course`, build and tag the commits group by group, push the branch and tags, then enable the tag CI. Rollback: delete the branch and tags. Nothing else depends on them until ai-web.dev publishes the lessons.
