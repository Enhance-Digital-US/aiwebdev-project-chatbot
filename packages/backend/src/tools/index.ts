import type { ToolSet } from "ai";
import { getWeather } from "./weather";
import { convertUnits } from "./convert-units";

export { createExecuteCodeTool } from "./execute-code";
export { createFileBugReportTool } from "./file-bug-report";

export const tools = {
  getWeather,
  convertUnits,
} satisfies ToolSet;
