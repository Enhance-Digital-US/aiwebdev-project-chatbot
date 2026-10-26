import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import type { McpServerConfig, McpToolLoader } from "./types";

/**
 * Dual-era Streamable HTTP client. "Modern" MCP (2026-07-28+) is stateless:
 * no initialize handshake, no sessions — every request carries its protocol
 * version and client info in `_meta`. "Legacy" servers (2025-11-25 and
 * earlier) still need initialize + Mcp-Session-Id. We try modern first and
 * fall back only when the server's rejection isn't a recognized modern error.
 */
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";
const CLIENT_INFO = { name: "chatbot-backend", version: "0.1.0" };

const REQUEST_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
  "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
  // We answer elicitations (confirmations) through the chat UI; see callTool.
  "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
};

type Era = "modern" | "legacy";

/**
 * The era is a property of the server, so remember legacy servers for the
 * isolate's lifetime instead of paying a failed modern probe on every chat
 * request. Unknown servers are assumed modern.
 */
const eraCache = new Map<string, Era>();

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
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

/** One `elicitation/create` input request from an MRTR `input_required` result. */
interface ElicitationRequest {
  method: "elicitation/create";
  params: {
    message: string;
    requestedSchema?: { properties?: Record<string, { type?: string }> };
  };
}

/** What the client answers for one input request. */
interface ElicitationResponse {
  action: "accept" | "decline";
  content?: Record<string, unknown>;
}

type CallResult =
  | { kind: "complete"; content: McpContentBlock[] }
  | { kind: "input-required"; requests: Record<string, ElicitationRequest>; requestState?: string };

/**
 * Checks an `input_required` result asks only for what this client can answer:
 * confirmations, i.e. elicitations whose form is empty or all booleans.
 */
function supportedInputRequests(
  serverName: string,
  toolName: string,
  inputRequests: unknown
): Record<string, ElicitationRequest> {
  const entries = Object.entries((inputRequests ?? {}) as Record<string, { method?: string; params?: unknown }>);
  if (entries.length === 0) {
    throw new Error(`${serverName}: tool "${toolName}" needs client input but sent no input requests`);
  }
  for (const [key, request] of entries) {
    if (request.method !== "elicitation/create") {
      throw new Error(
        `${serverName}: tool "${toolName}" needs client input this client does not support: ${request.method} (request "${key}")`
      );
    }
    const properties = (request as ElicitationRequest).params?.requestedSchema?.properties ?? {};
    const nonBoolean = Object.entries(properties).filter(([, prop]) => prop.type !== "boolean");
    if (nonBoolean.length > 0) {
      throw new Error(
        `${serverName}: tool "${toolName}" asks for a form this client does not support (fields: ${nonBoolean.map(([name]) => name).join(", ")})`
      );
    }
  }
  return Object.fromEntries(entries) as Record<string, ElicitationRequest>;
}

/** The user approved: accept every request, answering each boolean field "yes". */
function acceptAll(requests: Record<string, ElicitationRequest>): Record<string, ElicitationResponse> {
  return Object.fromEntries(
    Object.entries(requests).map(([key, request]) => [
      key,
      {
        action: "accept",
        content: Object.fromEntries(
          Object.keys(request.params.requestedSchema?.properties ?? {}).map((field) => [field, true])
        ),
      },
    ])
  );
}

/**
 * Finds the user's answer to the approval request for this tool call, if the
 * conversation already contains one (the request after the user decided).
 */
export function approvalFor(messages: ModelMessage[], toolCallId: string): boolean | undefined {
  let approvalId: string | undefined;
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-approval-request" && part.toolCallId === toolCallId) {
        approvalId = part.approvalId;
      } else if (part.type === "tool-approval-response" && approvalId && part.approvalId === approvalId) {
        return part.approved;
      }
    }
  }
  return undefined;
}

/** A tool parameter the server wants mirrored into an `Mcp-Param-*` header. */
interface HeaderParam {
  header: string;
  path: string[];
}

class McpHttpError extends Error {
  constructor(
    serverName: string,
    method: string,
    readonly status: number,
    readonly rpcError: JsonRpcError | undefined
  ) {
    super(
      `${serverName}: ${method} → HTTP ${status}` +
        (rpcError ? ` (JSON-RPC ${rpcError.code}: ${rpcError.message})` : "")
    );
  }
}

/**
 * Decides whether a non-2xx response came from a modern server (so we should
 * surface the error) or from a legacy one (so we should fall back to
 * initialize). Getting this wrong either hides real errors from modern servers
 * or strands legacy servers like DeepWiki, which answers a modern request with
 * `400` + JSON-RPC `-32600`.
 *
 * Modern-only error codes: -32020 HeaderMismatch,
 * -32021 MissingRequiredClientCapability, -32022 UnsupportedProtocolVersion
 * (`data.supported` lists the server's versions). A modern server also
 * answers an unknown method with `404` + `-32601`.
 */
function isModernError(status: number, error: JsonRpcError | undefined): boolean {
  // A server error isn't evidence of an era; surface it rather than retrying.
  if (status >= 500) return true;
  if (!error) return false;
  if (status === 404) return error.code === -32601;
  if (error.code === -32022) {
    // A version error that offers no modern version means "speak legacy".
    const supported = (error.data as { supported?: unknown } | undefined)?.supported;
    return Array.isArray(supported) && supported.includes(MODERN_VERSION);
  }
  return error.code === -32020 || error.code === -32021;
}

/**
 * Streamable HTTP allows a server to answer a POST with plain JSON or with an
 * SSE stream containing the JSON-RPC response. Handle both; a 202 or an empty
 * body yields null. Error responses (4xx) are parsed too so the caller can
 * tell modern servers from legacy ones.
 */
async function parseJsonRpcResponse(
  res: Response
): Promise<JsonRpcMessage | null> {
  if (res.status === 202) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      return JSON.parse(text) as JsonRpcMessage;
    }
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data) continue;
      const message = JSON.parse(data) as JsonRpcMessage;
      if (message.result || message.error) return message;
    }
    return null;
  } catch {
    return null;
  }
}

const SENTINEL = /^=\?base64\?.*\?=$/s;
// Visible ASCII, with inner spaces/tabs allowed but no leading/trailing whitespace.
const HEADER_SAFE = /^[\x21-\x7E](?:[\x20-\x7E\t]*[\x21-\x7E])?$/;

/** Header value encoding for Mcp-Name and Mcp-Param-*: plain if safe, else base64 sentinel. */
function encodeHeaderValue(value: string): string {
  if (HEADER_SAFE.test(value) && !SENTINEL.test(value)) return value;
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return `=?base64?${btoa(binary)}?=`;
}

// RFC 9110 field-name token characters.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_PARAM_TYPES = ["string", "integer", "boolean"];

/** Counts every `x-mcp-header` key in the schema, wherever it sits. */
function countAnnotations(schema: unknown, isPropertyMap = false): number {
  if (!schema || typeof schema !== "object") return 0;
  let count = 0;
  for (const [key, value] of Object.entries(schema)) {
    // Inside a `properties` map, keys are property names, not keywords.
    if (key === "x-mcp-header" && !isPropertyMap) count++;
    count += countAnnotations(value, !isPropertyMap && key === "properties");
  }
  return count;
}

/**
 * Collects a tool's `x-mcp-header` params, throwing if any annotation is
 * invalid (the spec requires dropping such tools). Annotations must be
 * reachable through `properties` keys only — never via items, $ref, or
 * composition keywords — so any annotation the walk misses is invalid.
 */
function collectHeaderParams(inputSchema: Record<string, unknown>): HeaderParam[] {
  const params: HeaderParam[] = [];
  const walk = (schema: Record<string, unknown>, path: string[]) => {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object") return;
    for (const [key, child] of Object.entries(properties)) {
      if (!child || typeof child !== "object") continue;
      const childSchema = child as Record<string, unknown>;
      const childPath = [...path, key];
      const header = childSchema["x-mcp-header"];
      if (header !== undefined) {
        if (typeof header !== "string" || !TOKEN.test(header)) {
          throw new Error(`invalid x-mcp-header ${JSON.stringify(header)} on "${childPath.join(".")}"`);
        }
        if (!HEADER_PARAM_TYPES.includes(childSchema.type as string)) {
          throw new Error(`x-mcp-header on non-primitive "${childPath.join(".")}"`);
        }
        params.push({ header, path: childPath });
      }
      walk(childSchema, childPath);
    }
  };
  walk(inputSchema, []);

  if (params.length !== countAnnotations(inputSchema)) {
    throw new Error("x-mcp-header must be reachable through `properties` only");
  }
  const seen = new Set<string>();
  for (const { header } of params) {
    if (seen.has(header.toLowerCase())) {
      throw new Error(`duplicate x-mcp-header "${header}"`);
    }
    seen.add(header.toLowerCase());
  }
  return params;
}

function paramHeaders(params: HeaderParam[], args: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { header, path } of params) {
    let value: unknown = args;
    for (const key of path) {
      value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    }
    if (value === undefined || value === null) continue;
    headers[`mcp-param-${header}`] = encodeHeaderValue(String(value));
  }
  return headers;
}

class RawMcpClient {
  private era: Era;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private readonly server: McpServerConfig) {
    this.era = eraCache.get(server.url) ?? "modern";
  }

  private get protocolVersion(): string {
    return this.era === "modern" ? MODERN_VERSION : LEGACY_VERSION;
  }

  private async post(
    body: { jsonrpc: "2.0"; id?: number; method: string; params?: Record<string, unknown> },
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    return fetch(this.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": this.protocolVersion,
        "mcp-method": body.method,
        ...(this.sessionId && { "mcp-session-id": this.sessionId }),
        ...extraHeaders,
        ...this.server.headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const res = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method,
        params: this.era === "modern" ? { ...params, _meta: REQUEST_META } : params,
      },
      extraHeaders
    );
    if (this.era === "legacy") {
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
    }

    const message = await parseJsonRpcResponse(res);
    if (!res.ok) {
      throw new McpHttpError(this.server.name, method, res.status, message?.error);
    }
    if (!message) {
      throw new Error(`${this.server.name}: ${method} → empty response`);
    }
    if (message.error) {
      throw new Error(
        `${this.server.name}: ${method} → JSON-RPC error ${message.error.code}: ${message.error.message}`
      );
    }
    // Missing resultType means "complete" (pre-2026 servers). An
    // "input_required" result is handled by the caller (only tools/call can
    // answer it).
    return message.result ?? {};
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: LEGACY_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  private async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request("tools/list", {});
    return (result.tools ?? []) as McpToolDefinition[];
  }

  /** Lists tools, detecting the server's era on first contact. */
  async connect(): Promise<McpToolDefinition[]> {
    try {
      if (this.era === "modern") return await this.listTools();
    } catch (err) {
      if (!(err instanceof McpHttpError) || isModernError(err.status, err.rpcError)) {
        throw err;
      }
      this.era = "legacy";
    }
    try {
      await this.initialize();
      const tools = await this.listTools();
      eraCache.set(this.server.url, "legacy");
      return tools;
    } catch (err) {
      // Re-probe next time rather than trusting a cached assumption that failed.
      eraCache.delete(this.server.url);
      throw err;
    }
  }

  /**
   * Calls a tool. Under MRTR a server may answer "input_required" instead of a
   * result; the caller then retries the same call with `answer`. The server is
   * stateless between the two legs, except for the `requestState` it minted.
   */
  async callTool(
    name: string,
    args: unknown,
    headerParams: HeaderParam[],
    answer?: { inputResponses: Record<string, ElicitationResponse>; requestState?: string }
  ): Promise<CallResult> {
    const result = await this.request(
      "tools/call",
      { name, arguments: args, ...answer },
      { "mcp-name": encodeHeaderValue(name), ...paramHeaders(headerParams, args) }
    );
    if (result.resultType === "input_required") {
      return {
        kind: "input-required",
        requests: supportedInputRequests(this.server.name, name, result.inputRequests),
        requestState: typeof result.requestState === "string" ? result.requestState : undefined,
      };
    }
    const content = (result.content ?? []) as McpContentBlock[];
    if (result.isError) {
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(`${this.server.name}: tool "${name}" failed: ${text}`);
    }
    return { kind: "complete", content };
  }

  async close(): Promise<void> {
    // Modern servers are stateless; only legacy sessions need terminating.
    if (this.era !== "legacy" || !this.sessionId) return;
    await fetch(this.server.url, {
      method: "DELETE",
      headers: {
        "mcp-session-id": this.sessionId,
        "mcp-protocol-version": LEGACY_VERSION,
        ...this.server.headers,
      },
    }).catch(() => {});
  }
}

export const rawLoader: McpToolLoader = async (server, hooks = {}) => {
  const client = new RawMcpClient(server);
  const definitions = await client.connect();
  // Outcomes of calls made while probing in needsApproval, keyed by toolCallId,
  // so execute doesn't call the tool a second time. Errors are kept too:
  // thrown from needsApproval they'd abort the whole response, but rethrown
  // from execute they become a tool error the model can read.
  const settled = new Map<string, { content: McpContentBlock[] } | { error: unknown }>();

  const tools: ToolSet = {};
  for (const def of definitions) {
    let headerParams: HeaderParam[];
    try {
      headerParams = collectHeaderParams(def.inputSchema);
    } catch (err) {
      console.warn(`MCP server "${server.name}": skipping tool "${def.name}":`, (err as Error).message);
      continue;
    }
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(
        def.inputSchema as Parameters<typeof jsonSchema>[0]
      ),
      // MRTR elicitation, carried by AI SDK tool approval (design §6). Approval
      // is decided before execute, but only the server knows whether it will
      // ask, so the call itself happens here.
      needsApproval: async (args, { toolCallId, messages }) => {
        // The user already answered (the request after their decision).
        if (approvalFor(messages, toolCallId) !== undefined) return true;
        let result: CallResult;
        try {
          result = await client.callTool(def.name, args, headerParams);
        } catch (error) {
          settled.set(toolCallId, { error });
          return false;
        }
        if (result.kind === "complete") {
          settled.set(toolCallId, { content: result.content });
          return false;
        }
        hooks.onElicitation?.({
          toolCallId,
          server: server.name,
          message: Object.values(result.requests).map((r) => r.params.message).join("\n"),
        });
        return true;
      },
      execute: async (args, { toolCallId, messages }) => {
        const done = settled.get(toolCallId);
        if (done) {
          settled.delete(toolCallId);
          if ("error" in done) throw done.error;
          return done.content;
        }
        const result = await client.callTool(def.name, args, headerParams);
        if (result.kind === "complete") return result.content;
        // Only answer "yes" on the user's behalf if they actually approved.
        if (approvalFor(messages, toolCallId) !== true) {
          throw new Error(`${server.name}: tool "${def.name}" needs the user's confirmation`);
        }
        const retried = await client.callTool(def.name, args, headerParams, {
          inputResponses: acceptAll(result.requests),
          requestState: result.requestState,
        });
        if (retried.kind !== "complete") {
          throw new Error(`${server.name}: tool "${def.name}" asked for input again after it was given`);
        }
        return retried.content;
      },
    });
  }

  return { tools, close: () => client.close() };
};

/**
 * One tool call outside a chat (e.g. from a workflow step): connect, call,
 * return the content. A server asking for input fails the call, since there
 * is no user to ask.
 */
export async function callMcpTool(
  server: McpServerConfig,
  name: string,
  args: Record<string, unknown>
): Promise<McpContentBlock[]> {
  const client = new RawMcpClient(server);
  try {
    const definitions = await client.connect();
    const def = definitions.find((d) => d.name === name);
    if (!def) throw new Error(`${server.name}: no tool "${name}"`);
    const result = await client.callTool(name, args, collectHeaderParams(def.inputSchema));
    if (result.kind !== "complete") {
      throw new Error(`${server.name}: tool "${name}" asked for user input outside a chat`);
    }
    return result.content;
  } finally {
    await client.close();
  }
}
