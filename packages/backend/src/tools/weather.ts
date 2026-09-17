import { tool } from "ai";
import { z } from "zod";

export const getWeather = tool({
  description: "Get current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
  execute: async ({ city }) => {
    const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temperature = Math.floor(Math.random() * 35) + 5;
    return { temperature, condition, city };
  },
});
