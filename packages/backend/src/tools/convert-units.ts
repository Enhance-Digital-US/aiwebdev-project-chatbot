import { tool } from "ai";
import { z } from "zod";

const conversions: Record<string, Record<string, (v: number) => number>> = {
  km: { miles: (v) => v * 0.621371, meters: (v) => v * 1000 },
  miles: { km: (v) => v * 1.60934, meters: (v) => v * 1609.34 },
  meters: { km: (v) => v / 1000, miles: (v) => v / 1609.34, feet: (v) => v * 3.28084 },
  feet: { meters: (v) => v / 3.28084, km: (v) => v / 3280.84 },
  celsius: { fahrenheit: (v) => v * 9 / 5 + 32, kelvin: (v) => v + 273.15 },
  fahrenheit: { celsius: (v) => (v - 32) * 5 / 9, kelvin: (v) => (v - 32) * 5 / 9 + 273.15 },
  kelvin: { celsius: (v) => v - 273.15, fahrenheit: (v) => (v - 273.15) * 9 / 5 + 32 },
  kg: { lbs: (v) => v * 2.20462, grams: (v) => v * 1000 },
  lbs: { kg: (v) => v / 2.20462, grams: (v) => v * 453.592 },
  grams: { kg: (v) => v / 1000, lbs: (v) => v / 453.592 },
};

export const convertUnits = tool({
  description: "Convert a value from one unit to another (length, temperature, weight)",
  inputSchema: z.object({
    value: z.number().describe("The numeric value to convert"),
    from: z.string().describe("The source unit (e.g. 'celsius', 'km', 'kg')"),
    to: z.string().describe("The target unit (e.g. 'fahrenheit', 'miles', 'lbs')"),
  }),
  execute: async ({ value, from, to }) => {
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    const converter = conversions[fromLower]?.[toLower];
    if (!converter) {
      return { value, from, to, result: `Error: cannot convert from ${from} to ${to}` };
    }
    const result = Math.round(converter(value) * 1000) / 1000;
    return { value, from, to, result };
  },
});
