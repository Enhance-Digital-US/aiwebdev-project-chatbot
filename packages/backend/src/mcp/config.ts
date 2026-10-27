import type { AppEnv } from "../types";
import type { McpServerConfig } from "./types";
import { createDevTokenSource } from "./credentials";
import { createOAuthSource } from "../oauth/tokens";

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

/** The issue tracker's MCP endpoint, also the audience (`resource`) of its OAuth tokens. */
export const issueTrackerResource = (env: AppEnv["Bindings"]) => env.ISSUE_TRACKER_URL ?? LOCAL_ISSUE_TRACKER_URL;

/**
 * How issue-tracker calls authenticate: per-user OAuth when deployed, dev
 * tokens locally. ISSUE_TRACKER_AUTH=oauth tries the OAuth flow locally.
 */
export function issueTrackerAuth(env: AppEnv["Bindings"]): "oauth" | "dev-token" {
  if (env.ISSUE_TRACKER_AUTH === "oauth" || env.ISSUE_TRACKER_AUTH === "dev-token") return env.ISSUE_TRACKER_AUTH;
  return env.ENVIRONMENT === "development" ? "dev-token" : "oauth";
}

export function getMcpServers(env: AppEnv["Bindings"]): McpServerConfig[] {
  const issueTrackerUrl = issueTrackerResource(env);
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
      // No credential (not connected, or deployed with dev tokens) skips it.
      credential:
        issueTrackerAuth(env) === "oauth"
          ? createOAuthSource({ resource: issueTrackerUrl })
          : devTokenSource(issueTrackerUrl),
    },
  ];
}
