# Tasks

## 1. Preconditions

- [ ] 1.1 Confirm `course-build-along-features` is complete on `main`, and mcp-server tags `lesson-13` and `lesson-16` exist on its remote; verify with `openspec list` here and `git ls-remote --tags` on the mcp-server remote

## 2. Early lessons

- [ ] 2.1 Create the `course` branch at root commit `4d3375d` and tag it `lesson-00`; verify the tag points at the empty root commit
- [ ] 2.2 Commit and tag lessons 03 (scaffold, port 8788, `.dev.vars.example`), 04 (chat route) and 05 (streaming UI); verify each tag installs, typechecks and builds, and contains no later-lesson code

## 3. Models, prompting, structure, tracing, tools

- [ ] 3.1 Commit and tag lessons 07, 08, 09, 10, 11 and 12; verify per tag as in 2.2, and that `lesson-08`'s Ollama model appears only in dev builds

## 4. MCP through sandbox

- [ ] 4.1 Commit and tag lessons 13, 14 and 15; verify per tag, and that the chatbot at `lesson-13` lists and calls issue-tracker tools against mcp-server at `lesson-13` (no `external_id` sent)

## 5. Workflow through cost

- [ ] 5.1 Commit and tag lessons 16, 17 and 18 (`.github/` CI first appears at 18); verify per tag, and that `lesson-16` files exactly one issue against mcp-server at `lesson-16`
- [ ] 5.2 Commit and tag lessons 19 and 20; verify per tag, and that `git diff --stat lesson-20 main -- . ':!openspec' ':!AGENTS.md'` prints nothing

## 6. Publish and guard

- [ ] 6.1 Push `course` and all tags; verify `git ls-remote --tags origin` lists `lesson-00`, `03`–`05` and `07`–`20`
- [ ] 6.2 Add a CI workflow that checks out every `lesson-*` tag and runs install, typecheck and build, plus the `.dev.vars` tracked-file check; verify it passes for all tags
