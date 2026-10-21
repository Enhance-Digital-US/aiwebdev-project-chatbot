# Skills Support — Design

**Date:** 2026-09-19
**Status:** Approved design, pending implementation plan
**Sub-project:** 2 of 6 (roadmap: MCP → Skills → Secure code execution → Durable execution → Guardrails → Evals)

## Context

The chatbot (Hono on Cloudflare Workers, AI SDK v7, React/Vite frontend) has
local tools and MCP-discovered remote tools merged into `streamText()`. This
phase adds **Agent Skills support**: a progressive-disclosure system that lets
the model load behavioral instructions on demand, complementing MCP's
capability layer.

**MCP vs Skills — the core distinction:**

| Concern | MCP | Skills |
|---------|-----|--------|
| What it adds | Entries in `tools: {}` — callable capabilities | Content in `system:` — behavioral instructions |
| Discovery | Server connect + `tools/list` at request time | Parse `SKILL.md` frontmatter at build time |
| Activation | Model calls the tool, gets data back | Model calls `loadSkill` tool, gets instructions back |
| Persistence | Tools available per-request | Instructions persist in message history as tool results |
| Purpose | "Here's what you can access" | "Here's how you should think/respond" |

This is a learning project. The implementation follows the
[Agent Skills specification](https://agentskills.io/specification) and
references the [AI SDK cookbook guide](https://ai-sdk.dev/cookbook/guides/agent-skills).

## Decisions (from brainstorming)

- **Static project files** — Skills live as `SKILL.md` files in the backend
  source, bundled at build time via Wrangler raw imports. No KV, no remote
  registry.
- **Model-driven activation** — The model sees a catalog of skill
  names+descriptions in the system prompt. When it decides a skill is relevant,
  it calls a `loadSkill` tool. Progressive disclosure in action.
- **Two demo skills** — `eli5-explainer` (patient teacher persona) and
  `senior-architect` (full-stack web dev + GenAI production architect). Chosen
  to demonstrate skills as behavior modifiers — same question, radically
  different responses.
- **No frontend changes** — The `loadSkill` tool renders via the existing
  `ToolInvocation` component as a regular tool call, making progressive
  disclosure visible in the UI.
- **No automated tests this phase** — manual verification only (consistent
  with MCP phase).

## Architecture

New backend module `packages/backend/src/skills/`:

```
skills/
  eli5-explainer/
    SKILL.md              ← Agent Skills spec format
  senior-architect/
    SKILL.md              ← Agent Skills spec format
  discovery.ts            ← parses SKILL.md at build time, exports catalog
  load-skill.ts           ← the loadSkill tool definition
  index.ts                ← exports tool + catalog builder
```

### Skill Files

Each `SKILL.md` follows the Agent Skills specification: YAML frontmatter with
`name` and `description` (required), followed by a markdown body containing
behavioral instructions.

**`eli5-explainer`**: Instructs the model to explain concepts using everyday
analogies, short sentences, no unexplained jargon, "imagine..." framing, and
progressive depth on follow-ups.

**`senior-architect`**: Instructs the model to respond as a production-focused
full-stack web + GenAI engineer — lead with trade-offs, consider token costs
and latency budgets, reference AI-specific patterns (RAG, tool-use loops,
context window management, model fallbacks), name what to avoid and why,
assume a technical audience.

### Discovery (`discovery.ts`)

Skills are imported as raw text at build time using Wrangler's module rules
for `.md` files. Each import yields the full `SKILL.md` content as a string.

The discovery module:

1. Imports each `SKILL.md` as a raw string
2. Parses YAML frontmatter to extract `name` and `description`
3. Extracts the body (everything after the closing `---`)
4. Exports two structures:
   - `skillCatalog`: array of `{ name, description }` for system prompt injection
   - `skillBodies`: `Record<string, string>` mapping name → body for the tool

Adding a new skill requires: creating the `SKILL.md` file and adding one
import line. For a learning project with 2-3 skills, this explicitness is
clearer than magic directory scanning.

### The `loadSkill` Tool (`load-skill.ts`)

A standard AI SDK `tool()` that returns behavioral instructions instead of data.

```ts
tool({
  description: "Load a skill to get specialized instructions for a task. "
    + "Available skills are listed in the system prompt.",
  parameters: z.object({
    name: z.enum(["eli5-explainer", "senior-architect"]),
  }),
  execute: async ({ name }) => {
    return { skill: name, instructions: skillBodies[name] };
  },
})
```

Key properties:

- **Enum-constrained input**: `z.enum()` built from discovered skill names
  prevents hallucinated skill names
- **Returns instructions, not data**: The tool result contains behavioral
  instructions that shape subsequent model responses
- **No state management**: Instructions persist in message history as a tool
  result — the AI SDK and frontend `useChat` handle this automatically
- **One step cost**: Loading a skill consumes one step of the `isStepCount(5)`
  budget, leaving 4 steps for tool chaining

### Exports (`index.ts`)

```ts
export { loadSkill } from "./load-skill";
export { buildSkillsPrompt } from "./discovery";
```

`buildSkillsPrompt()` returns a string to append to the system prompt:

```
<available_skills>
- eli5-explainer: Explains any concept using simple analogies...
- senior-architect: Responds with production-grade full-stack + GenAI analysis...
When a task matches a skill's description, call the loadSkill tool to activate it.
</available_skills>
```

~100 tokens for two skills. Negligible per-request overhead.

## Chat Route Changes (`routes/chat.ts`)

```ts
import { loadSkill, buildSkillsPrompt } from "../skills";

// In the route handler:
const skillsPrompt = buildSkillsPrompt();

const result = streamText({
  model: config.createModel(c.env),
  system: `You are a helpful assistant.\n\n${skillsPrompt}`,
  // ...
  tools: { ...tools, ...mcpTools, loadSkill },
  // ...
});
```

The tool merge order mirrors the conceptual layers:
local tools → remote MCP tools → skill loader.

`loadSkill` is included regardless of `supportsTools` — if the model doesn't
support tools, none are passed (existing behavior), so the skill catalog in
the system prompt is inert.

## Wrangler Configuration

Add a rule to handle `.md` files as text modules:

```toml
[[rules]]
type = "Text"
globs = ["**/*.md"]
```

This lets `import content from "./eli5-explainer/SKILL.md"` yield a string.

## Frontend

**No changes required.** The `loadSkill` tool is statically defined in the
`tools` object, so it streams as a `tool-loadSkill` part (not `dynamic-tool`,
which is for runtime-discovered MCP tools). The existing `ToolInvocation`
component handles both via the `part.type.startsWith("tool-")` check. The UI
shows:

- Tool name: `loadSkill`
- Parameters: `{"name": "eli5-explainer"}`
- Result: the skill's instruction body

This makes the progressive disclosure pattern visible to learners — they can
see the model deciding to load a skill and the instructions it receives.

## Error Handling

- **Unknown skill name**: Impossible at the type level (`z.enum`), but a
  runtime fallback returns a clear error message.
- **Malformed SKILL.md**: Parse errors during discovery are logged at build
  time. A skill with unparseable frontmatter or missing description is skipped
  with a warning.

## Verification (manual)

1. `pnpm dev`; ask "What is a database index?" — confirm normal response.
2. Ask "Explain database indexes like I'm five" — confirm the model loads
   `eli5-explainer` and responds with analogies and simple language.
3. Ask "How should I design indexing for a high-traffic AI app?" — confirm the
   model loads `senior-architect` and responds with production trade-offs,
   GenAI-specific considerations.
4. Start a new conversation, explicitly ask "Load the eli5-explainer skill and
   then explain WebSockets" — confirm the model calls `loadSkill`, the tool
   call renders in the UI, and subsequent response uses the skill's style.
5. Confirm skill loading works alongside MCP tools — e.g., "Use the
   senior-architect skill and search Cloudflare docs for Durable Objects."

## Out of Scope (deferred to later phases)

- User-managed skill installation / settings UI → later, with persistence
- Remote skill registries / dynamic installation → later
- Skill resource files (scripts/, references/) → not needed for persona skills
- Context compaction protection for skill content → later, with longer conversations
- Subagent delegation for skills → phase 4 (Durable execution)
