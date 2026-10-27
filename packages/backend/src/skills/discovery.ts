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

export const skillCatalog: SkillMeta[] = parsed.map(
  ({ name, description }) => ({ name, description })
);

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
