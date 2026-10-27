import type { ToolSet } from "ai";
import { getWeather } from "./weather";
import { convertUnits } from "./convert-units";

export const tools = {
  getWeather,
  convertUnits,
} satisfies ToolSet;
