import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpToolLoader } from "./types";

// @ai-sdk/mcp's HTTP transport calls fetch with an unbound `this`, which
// triggers "Illegal invocation" on Cloudflare Workers (workerd enforces strict
// `this` on built-in globals). This loader works in Node but not in Workers;
// use MCP_IMPL="raw" (the default) for Workers deployments.
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
