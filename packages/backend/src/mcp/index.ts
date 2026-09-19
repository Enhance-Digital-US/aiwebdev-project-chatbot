import type { ToolSet } from "ai";
import type { AppEnv } from "../types";
import type { McpConnection, McpToolLoader } from "./types";
import { mcpServers } from "./config";
import { aiSdkLoader } from "./ai-sdk-loader";
import { rawLoader } from "./raw-loader";

const CONNECT_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label}: connect timed out after ${CONNECT_TIMEOUT_MS}ms`
            )
          ),
        CONNECT_TIMEOUT_MS
      )
    ),
  ]);
}

export async function loadMcpTools(
  env: AppEnv["Bindings"]
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const loader: McpToolLoader =
    env.MCP_IMPL === "ai-sdk" ? aiSdkLoader : rawLoader;
  const enabled = mcpServers.filter((server) => server.enabled);

  const results = await Promise.allSettled(
    enabled.map((server) => withTimeout(loader(server), server.name))
  );

  const tools: ToolSet = {};
  const connections: McpConnection[] = [];

  results.forEach((result, i) => {
    const server = enabled[i];
    if (result.status === "rejected") {
      console.error(
        `MCP server "${server.name}" unavailable:`,
        result.reason
      );
      return;
    }
    connections.push(result.value);
    for (const [name, remoteTool] of Object.entries(result.value.tools)) {
      tools[`${server.name}_${name}`] = remoteTool;
    }
  });

  return {
    tools,
    close: async () => {
      await Promise.allSettled(connections.map((c) => c.close()));
    },
  };
}
