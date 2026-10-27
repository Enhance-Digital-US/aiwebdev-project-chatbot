import type { ToolSet } from "ai";
import type { CredentialSource } from "./credentials";

export interface McpServerConfig {
  /** Short slug; becomes the tool-name prefix, e.g. "cf-docs" → "cf-docs_search_docs" */
  name: string;
  /** Streamable HTTP endpoint */
  url: string;
  enabled: boolean;
  /** Static headers; secret values should come from Worker secrets */
  headers?: Record<string, string>;
  /** Per-request auth headers; resolved before connecting. null → server skipped. */
  credential?: CredentialSource;
}

export interface McpConnection {
  tools: ToolSet;
  close: () => Promise<void>;
}

/** A server asked the user to confirm a tool call (MRTR elicitation). */
export interface McpElicitation {
  toolCallId: string;
  server: string;
  message: string;
}

export interface McpHooks {
  /** Called when a tool call pauses for the user; the UI shows a confirmation card. */
  onElicitation?: (elicitation: McpElicitation) => void;
}

/** Connects to ONE server and returns its (un-namespaced) tools. */
export type McpToolLoader = (server: McpServerConfig, hooks?: McpHooks) => Promise<McpConnection>;
