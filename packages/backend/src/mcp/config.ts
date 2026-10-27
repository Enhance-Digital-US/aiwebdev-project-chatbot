import type { AppEnv } from "../types";
import type { McpServerConfig } from "./types";
import { createDevTokenSource } from "./credentials";

/** Local issue tracker (the mcp-server repo's `pnpm dev`); it refuses any other port. */
const LOCAL_ISSUE_TRACKER_URL = "http://localhost:8787/mcp";

/** Dev tokens are minted per isolate and cached by the source, so keep one per tracker origin. */
const devTokenSources = new Map<string, ReturnType<typeof createDevTokenSource>>();

function devTokenSource(trackerUrl: string) {
  const tokenUrl = new URL("/auth/dev-token", trackerUrl).toString();
  let source = devTokenSources.get(tokenUrl);
  if (!source) devTokenSources.set(tokenUrl, (source = createDevTokenSource({ tokenUrl })));
  return source;
}

export function getMcpServers(env: AppEnv["Bindings"]): McpServerConfig[] {
  const issueTrackerUrl = env.ISSUE_TRACKER_URL ?? LOCAL_ISSUE_TRACKER_URL;
  return [
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
      url: issueTrackerUrl,
      enabled: true,
      // Dev tokens only exist locally, so when deployed this source returns
      // null and the server is skipped (per-user OAuth replaces it in lesson 19).
      credential: devTokenSource(issueTrackerUrl),
    },
  ];
}
