# skills Specification

## Purpose

Agent Skills (agentskills.io format): behavioral instructions bundled with the backend and loaded by the model on demand through a `loadSkill` tool, so a response style can change without changing the system prompt.

## Requirements

### Requirement: Skill files
Each skill SHALL be a `SKILL.md` file with YAML frontmatter containing `name` and `description`, followed by a markdown body of instructions. Skills SHALL be bundled at build time as raw text. A skill missing either field or with unparseable frontmatter SHALL be skipped with a logged error.

#### Scenario: Bundled skills
- **WHEN** the backend starts
- **THEN** the skills `eli5-explainer` and `senior-architect` are available

#### Scenario: Missing description
- **WHEN** a `SKILL.md` has no `description` in its frontmatter
- **THEN** that skill is left out of the catalog and an error is logged

### Requirement: Skill catalog in system prompt
The system prompt SHALL include an `<available_skills>` block listing each skill's name and description, followed by an instruction to call `loadSkill` when a task matches a skill. With no skills, the block SHALL be omitted.

#### Scenario: Catalog content
- **WHEN** a chat request is processed
- **THEN** the system prompt lists `eli5-explainer` and `senior-architect` with their descriptions

### Requirement: Loading a skill
The `loadSkill` tool SHALL accept a `name` restricted to the known skill names and SHALL return `{ skill, instructions }` with the skill's markdown body. An unknown name SHALL return `{ error: "Unknown skill: <name>" }`.

#### Scenario: Model loads a skill
- **WHEN** a user asks "Explain database indexes like I'm five"
- **THEN** the model may call `loadSkill` with `eli5-explainer` and answer in that skill's style

### Requirement: Skill instructions persist through history
Loaded instructions SHALL persist only as a tool result in the conversation history, with no extra server-side state.

#### Scenario: Follow-up question
- **WHEN** a skill was loaded earlier in the conversation and the user asks a follow-up
- **THEN** the earlier tool result is still in the message history sent to the model

### Requirement: Skill loads visible in the UI
A `loadSkill` call SHALL appear in the chat as a regular tool invocation showing the skill name requested and the instructions returned.

#### Scenario: Visible progressive disclosure
- **WHEN** the model loads `senior-architect`
- **THEN** the chat shows a `loadSkill` tool invocation with input `{"name": "senior-architect"}`

### Requirement: Skills require tool support
`loadSkill` SHALL be offered only to models that support tools. For other models the catalog stays in the prompt but no skill can be loaded.

#### Scenario: Model without tools
- **WHEN** the selected model has tool support off
- **THEN** `loadSkill` is not offered
