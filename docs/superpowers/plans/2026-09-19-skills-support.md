# Skills Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agent Skills support so the model can load behavioral instructions on demand, complementing MCP's capability layer.

**Architecture:** Skills are `SKILL.md` files bundled at build time as text modules. A discovery module parses their frontmatter into a catalog (injected into the system prompt) and a body map (returned by a `loadSkill` tool). The model decides when to activate a skill; its instructions persist in message history as a tool result.

**Tech Stack:** AI SDK v7 `tool()`, Zod, Wrangler text module rules, YAML frontmatter (hand-parsed)

**Spec:** `docs/superpowers/specs/2026-09-19-skills-support-design.md`

## Global Constraints

- No new dependencies — use `ai`, `zod` (already installed)
- No frontend changes — `loadSkill` renders via existing `ToolInvocation` component
- No automated tests this phase — manual verification only
- SKILL.md files follow the [Agent Skills specification](https://agentskills.io/specification)
- Existing tool convention: use `inputSchema` (not `parameters`) in `tool()` calls

---

### Task 1: Skill discovery module with demo skills

**Files:**
- Modify: `packages/backend/wrangler.toml` (add `[[rules]]` for `.md` text modules)
- Create: `packages/backend/src/skills/types.d.ts` (TypeScript declaration for `.md` imports)
- Create: `packages/backend/src/skills/eli5-explainer/SKILL.md`
- Create: `packages/backend/src/skills/senior-architect/SKILL.md`
- Create: `packages/backend/src/skills/discovery.ts`

**Interfaces:**
- Consumes: nothing (foundational task)
- Produces:
  - `buildSkillsPrompt(): string` — returns the `<available_skills>` block for the system prompt
  - `skillBodies: Record<string, string>` — maps skill name → SKILL.md body content
  - `skillNames: [string, ...string[]]` — tuple of valid skill names for `z.enum()`

- [ ] **Step 1: Add Wrangler text module rule**

Add a `[[rules]]` block to `packages/backend/wrangler.toml` so Wrangler
bundles `.md` files as text modules:

```toml
[[rules]]
type = "Text"
globs = ["**/*.md"]
```

This makes `import content from "./foo/SKILL.md"` yield a `string` at build time.

- [ ] **Step 2: Add TypeScript declaration for `.md` imports**

Create `packages/backend/src/skills/types.d.ts`:

```ts
declare module "*.md" {
  const content: string;
  export default content;
}
```

This tells TypeScript that `.md` default imports are strings.

- [ ] **Step 3: Create the eli5-explainer skill**

Create `packages/backend/src/skills/eli5-explainer/SKILL.md`:

```markdown
---
name: eli5-explainer
description: Explains any concept using simple everyday analogies, short sentences, and no unexplained jargon. Use when the user wants a beginner-friendly explanation.
---

# How to explain

You are now in "explain like I'm five" mode. Follow these rules for all
subsequent responses in this conversation:

## Communication style

- Use everyday analogies: databases are filing cabinets, APIs are restaurant
  waiters, caching is keeping a copy of your homework on your desk instead of
  walking to the library every time.
- Keep sentences short. One idea per sentence.
- Never use jargon without immediately explaining it in plain words.
- Start explanations with "Imagine..." to make abstract concepts concrete.
- Use "you know how..." to connect to things the user already understands.

## Structure

- Start with the simplest version of the answer (one sentence).
- Then expand with an analogy.
- Then give one concrete example.
- Stop there unless the user asks for more.

## On follow-ups

- If the user asks a follow-up, go one level deeper but keep the approachable
  tone.
- If they ask "but why?", give the next layer of the onion — don't jump to
  the full technical explanation.

## What to avoid

- Do not use acronyms without spelling them out.
- Do not assume knowledge of programming concepts, math, or CS theory.
- Do not say "it's simple" or "obviously" — if it were obvious, they
  wouldn't be asking.
```

- [ ] **Step 4: Create the senior-architect skill**

Create `packages/backend/src/skills/senior-architect/SKILL.md`.

This is a meaningful design decision — the skill's instructions define what
"senior architect thinking" means for a full-stack web + GenAI context.

**Your task:** Write the SKILL.md body for the senior-architect skill.
The frontmatter is:

```yaml
---
name: senior-architect
description: Responds as a production-focused full-stack web and GenAI architect. Leads with trade-offs, considers scale and failure modes, and references industry patterns. Use for architecture decisions, system design, and production readiness reviews.
---
```

**Guidance for the body — consider these areas:**
- Trade-off framing: always present alternatives with pros/cons, not just one answer
- AI-specific concerns: token costs, latency budgets, streaming vs batch, model fallbacks, prompt engineering patterns, RAG vs fine-tuning decisions
- Web architecture: edge deployment, caching, SSR/streaming, real-time patterns
- Production lens: failure modes, observability, graceful degradation, operational burden
- Communication style: assume a technical audience, reference patterns by name (CQRS, circuit breakers, bulkheads), state what to avoid and why

- [ ] **Step 5: Create the discovery module**

Create `packages/backend/src/skills/discovery.ts`:

```ts
import eli5Raw from "./eli5-explainer/SKILL.md";
import architectRaw from "./senior-architect/SKILL.md";

export interface SkillMeta {
  name: string;
  description: string;
}

interface ParsedSkill extends SkillMeta {
  body: string;
}

function parseSkillMd(raw: string, path: string): ParsedSkill | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.error(`Skills: failed to parse frontmatter in ${path}`);
    return null;
  }

  const [, frontmatter, body] = match;

  let name = "";
  let description = "";
  for (const line of frontmatter.split("\n")) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) name = nameMatch[1].trim();
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) description = descMatch[1].trim();
  }

  if (!name || !description) {
    console.error(`Skills: missing name or description in ${path}`);
    return null;
  }

  return { name, description, body: body.trim() };
}

const rawSkills = [
  { raw: eli5Raw, path: "eli5-explainer/SKILL.md" },
  { raw: architectRaw, path: "senior-architect/SKILL.md" },
];

const parsed = rawSkills
  .map(({ raw, path }) => parseSkillMd(raw, path))
  .filter((s): s is ParsedSkill => s !== null);

export const skillCatalog: SkillMeta[] = parsed.map(({ name, description }) => ({
  name,
  description,
}));

export const skillBodies: Record<string, string> = Object.fromEntries(
  parsed.map(({ name, body }) => [name, body])
);

export const skillNames = parsed.map((s) => s.name) as [string, ...string[]];

export function buildSkillsPrompt(): string {
  if (skillCatalog.length === 0) return "";

  const entries = skillCatalog
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return [
    "<available_skills>",
    entries,
    "When a task matches a skill's description, call the loadSkill tool to activate it.",
    "</available_skills>",
  ].join("\n");
}
```

- [ ] **Step 6: Verify the build works**

Run: `cd packages/backend && npx wrangler deploy --dry-run --outdir /tmp/skills-test`

Expected: Build succeeds with no TypeScript or bundling errors. The `.md`
files are bundled as text modules. Check the output confirms no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/wrangler.toml \
       packages/backend/src/skills/
git commit -m "feat(skills): add skill discovery module with two demo skills

Add eli5-explainer and senior-architect SKILL.md files following the Agent
Skills spec. Discovery module parses frontmatter at build time and exports
a catalog for system prompt injection and a body map for the loadSkill tool."
```

---

### Task 2: loadSkill tool and chat route integration

**Files:**
- Create: `packages/backend/src/skills/load-skill.ts`
- Create: `packages/backend/src/skills/index.ts`
- Modify: `packages/backend/src/routes/chat.ts`

**Interfaces:**
- Consumes:
  - `skillBodies: Record<string, string>` from `discovery.ts`
  - `skillNames: [string, ...string[]]` from `discovery.ts`
  - `buildSkillsPrompt(): string` from `discovery.ts`
- Produces:
  - `loadSkill` — an AI SDK `tool()` instance added to the chat tools object

- [ ] **Step 1: Create the loadSkill tool**

Create `packages/backend/src/skills/load-skill.ts`:

```ts
import { tool } from "ai";
import { z } from "zod";
import { skillBodies, skillNames } from "./discovery";

export const loadSkill = tool({
  description:
    "Load a skill to get specialized instructions for a task. " +
    "Available skills are listed in the system prompt under <available_skills>.",
  inputSchema: z.object({
    name: z
      .enum(skillNames)
      .describe("The name of the skill to load"),
  }),
  execute: async ({ name }) => {
    const body = skillBodies[name];
    if (!body) {
      return { error: `Unknown skill: ${name}` };
    }
    return { skill: name, instructions: body };
  },
});
```

- [ ] **Step 2: Create the barrel export**

Create `packages/backend/src/skills/index.ts`:

```ts
export { loadSkill } from "./load-skill";
export { buildSkillsPrompt } from "./discovery";
```

- [ ] **Step 3: Integrate into the chat route**

Modify `packages/backend/src/routes/chat.ts`. Two changes:

1. Add the imports at the top (after existing imports):

```ts
import { loadSkill, buildSkillsPrompt } from "../skills";
```

2. Build the skills prompt and wire it into `streamText()`:

Replace the existing `system:` and `tools:` lines in the `streamText` call.
The system prompt gets the skills catalog appended. The tools object gets
`loadSkill` merged in after MCP tools:

```ts
const skillsPrompt = buildSkillsPrompt();

const result = streamText({
  model: config.createModel(c.env),
  system: `You are a helpful assistant.\n\n${skillsPrompt}`,
  messages: await convertToModelMessages(messages),
  providerOptions: config.providerOptions,
  ...(supportsTools && {
    tools: { ...tools, ...mcpTools, loadSkill },
    stopWhen: isStepCount(5),
  }),
  telemetry: { functionId: config.telemetryId },
  onEnd() {
    c.executionCtx.waitUntil(Promise.all([closeMcp(), flushTelemetry()]));
  },
});
```

- [ ] **Step 4: Verify the build**

Run: `cd packages/backend && npx wrangler deploy --dry-run --outdir /tmp/skills-test-2`

Expected: Build succeeds. No type errors, no missing imports.

- [ ] **Step 5: Manual end-to-end verification**

Start the dev server: `pnpm dev`

Test these scenarios in the browser:

1. **Normal chat (no skill):** Ask "What is a database index?" — should get
   a standard helpful response with no `loadSkill` call.

2. **ELI5 activation:** Ask "Explain database indexes like I'm five" — the
   model should call `loadSkill({ name: "eli5-explainer" })`, you'll see the
   tool invocation in the UI, then the response should use analogies and
   simple language.

3. **Architect activation:** Ask "How should I design indexing for a
   high-traffic AI app?" — the model should call
   `loadSkill({ name: "senior-architect" })` and respond with production
   trade-offs, GenAI-specific considerations.

4. **Skill + MCP together:** Ask "Use the senior-architect skill and search
   the Cloudflare docs for Durable Object alarms" — should see both
   `loadSkill` and an MCP tool call, with the response framed through the
   architect's production lens.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/skills/load-skill.ts \
       packages/backend/src/skills/index.ts \
       packages/backend/src/routes/chat.ts
git commit -m "feat(skills): wire loadSkill tool into chat route

Add the loadSkill tool (model-driven, enum-constrained) and integrate it
into the chat route alongside local and MCP tools. The system prompt now
includes a skills catalog for progressive disclosure."
```
