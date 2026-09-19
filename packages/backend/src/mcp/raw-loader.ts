import { jsonSchema, tool, type ToolSet } from "ai";
import type { McpServerConfig, McpToolLoader } from "./types";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpContentBlock {
  type: string;
  text?: string;
}

/**
 * Streamable HTTP allows a server to answer a POST with plain JSON or with an
 * SSE stream containing the JSON-RPC response. Handle both; a 202 with no body
 * is the ack for notifications.
 */
async function parseJsonRpcResponse(
  res: Response
): Promise<JsonRpcMessage | null> {
  if (res.status === 202) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data) continue;
      const message = JSON.parse(data) as JsonRpcMessage;
      if (message.id !== undefined) return message;
    }
    return null;
  }
  return (await res.json()) as JsonRpcMessage;
}

class RawMcpClient {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private readonly server: McpServerConfig) {}

  private async post(body: Record<string, unknown>): Promise<Response> {
    return fetch(this.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(this.sessionId && { "mcp-session-id": this.sessionId }),
        ...this.server.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    if (!res.ok) {
      throw new Error(`${this.server.name}: ${method} → HTTP ${res.status}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const message = await parseJsonRpcResponse(res);
    if (!message) {
      throw new Error(`${this.server.name}: ${method} → empty response`);
    }
    if (message.error) {
      throw new Error(
        `${this.server.name}: ${method} → JSON-RPC error ${message.error.code}: ${message.error.message}`
      );
    }
    return message.result ?? {};
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "chatbot-backend", version: "0.1.0" },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request("tools/list", {});
    return (result.tools ?? []) as McpToolDefinition[];
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const content = (result.content ?? []) as McpContentBlock[];
    if (result.isError) {
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(`${this.server.name}: tool "${name}" failed: ${text}`);
    }
    return content;
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(this.server.url, {
      method: "DELETE",
      headers: {
        "mcp-session-id": this.sessionId,
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...this.server.headers,
      },
    }).catch(() => {});
  }
}

export const rawLoader: McpToolLoader = async (server) => {
  const client = new RawMcpClient(server);
  await client.initialize();
  const definitions = await client.listTools();

  const tools: ToolSet = {};
  for (const def of definitions) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(
        def.inputSchema as Parameters<typeof jsonSchema>[0]
      ),
      execute: (args) => client.callTool(def.name, args),
    });
  }

  return { tools, close: () => client.close() };
};
