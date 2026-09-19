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
