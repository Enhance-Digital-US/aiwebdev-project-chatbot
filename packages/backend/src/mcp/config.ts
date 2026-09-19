import type { McpServerConfig } from "./types";

export const mcpServers: McpServerConfig[] = [
  {
    name: "cf-docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    enabled: true,
  },
  {
    name: "deepwiki",
    url: "https://mcp.deepwiki.com/mcp",
    enabled: true,
  },
];
