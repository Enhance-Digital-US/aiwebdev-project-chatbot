import type { ToolSet } from "ai";
import type { AppEnv } from "../types";
import type { McpConnection, McpHooks, McpServerConfig, McpToolLoader } from "./types";
import type { CredentialContext } from "./credentials";
import { getMcpServers } from "./config";
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

/** Merges the server's per-request credential into its headers; null → skip. */
export async function withCredentials(
  server: McpServerConfig,
  ctx: CredentialContext
): Promise<McpServerConfig | null> {
  if (!server.credential) return server;
  const headers = await server.credential(ctx);
  if (!headers) return null;
  return { ...server, headers: { ...server.headers, ...headers } };
}

export async function loadMcpTools(
  env: AppEnv["Bindings"],
  ctx: Omit<CredentialContext, "env">,
  hooks?: McpHooks
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const loader: McpToolLoader =
    env.MCP_IMPL === "ai-sdk" ? aiSdkLoader : rawLoader;
  const enabled = getMcpServers(env).filter((server) => server.enabled);

  const results = await Promise.allSettled(
    enabled.map((server) =>
      withTimeout(
        // null: no credential for this request (e.g. dev tokens when deployed)
        withCredentials(server, { env, ...ctx }).then((resolved) =>
          resolved ? loader(resolved, hooks) : null
        ),
        server.name
      )
    )
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
    if (!result.value) return;
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
