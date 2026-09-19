import type { ToolSet } from "ai";

export interface McpServerConfig {
  /** Short slug; becomes the tool-name prefix, e.g. "cf-docs" → "cf-docs_search_docs" */
  name: string;
  /** Streamable HTTP endpoint */
  url: string;
  enabled: boolean;
  /** For future authenticated servers; values should come from Worker secrets */
  headers?: Record<string, string>;
}

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

/** Connects to ONE server and returns its (un-namespaced) tools. */
export type McpToolLoader = (server: McpServerConfig) => Promise<McpConnection>;
