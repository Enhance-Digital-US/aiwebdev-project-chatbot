import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpToolLoader } from "./types";

export const aiSdkLoader: McpToolLoader = async (server) => {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: server.url,
      ...(server.headers && { headers: server.headers }),
    },
  });
  const tools = (await client.tools()) as ToolSet;
  return { tools, close: () => client.close() };
};
