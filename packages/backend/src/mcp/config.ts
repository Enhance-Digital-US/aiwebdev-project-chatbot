import type { McpServerConfig } from "./types";
import { createDevTokenSource } from "./credentials";

/** The course's issue-tracker MCP server (mcp-server repo), run locally on 8787. */
const ISSUE_TRACKER_ORIGIN = "http://localhost:8787";

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
  {
    name: "issue-tracker",
    url: `${ISSUE_TRACKER_ORIGIN}/mcp`,
    enabled: true,
    // Dev tokens only exist locally, so when deployed this source returns
    // null and the server is skipped (per-user OAuth replaces it in lesson 19).
    credential: createDevTokenSource({ tokenUrl: `${ISSUE_TRACKER_ORIGIN}/auth/dev-token` }),
  },
];
