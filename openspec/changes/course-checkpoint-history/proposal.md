# Proposal

## Why

Learners build this chatbot one lesson at a time. They need to check out the exact code each lesson starts from and compare their work with where it should end. `main`'s history can't provide that:
- its early commits predate the backend consolidation and the shadcn migration
- features landed in a different order than the lessons teach them

## What Changes

- A new `course` branch with one commit per module 02 build lesson, replayed in lesson order from the empty root commit. Each commit is tagged `lesson-NN`, using ai-web.dev's new lesson numbering.
- `lesson-00` is the existing empty root commit. Concept lessons (01, 02, 06) get no tag.
- The code at `lesson-20` matches `main` exactly. Project documentation that describes the finished app (`openspec/`, `AGENTS.md`) is excluded from that comparison and stays on `main` only.
- CI checks out every `lesson-*` tag and runs install, typecheck and build.
- `main` and its history are unchanged. `course` is additive.

## Capabilities

### New Capabilities
<!-- none: this change adds git history and CI, no app behavior (skip_specs: true) -->

### Modified Capabilities
<!-- none -->

## Impact

- New branch `course`, plus tags `lesson-00`, `03`–`05` and `07`–`20`, pushed to the public remote.
- New CI workflow for tags.
- **Depends on** `course-build-along-features` being complete on `main`, and on mcp-server tags `lesson-13` and `lesson-16` existing (mcp-server change `idempotent-issue-creation`).
- **Consumed by** ai-web.dev's `ProjectCheckpoint` widget and lesson frontmatter (change `chatbot-build-along`).
