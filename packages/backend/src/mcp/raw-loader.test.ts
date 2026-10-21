import { afterEach, describe, expect, it, vi } from "vitest";
import { rawLoader } from "./raw-loader";

interface Call {
  method: string;
  headers: Record<string, string>;
  body: { method?: string; params?: Record<string, unknown> } | null;
}

/** Stubs fetch with a handler per JSON-RPC method; records every call. */
function stubServer(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
      ),
      body: init.body ? JSON.parse(init.body as string) : null,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const searchTool = {
  name: "search",
  description: "Search",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
};

let serverCount = 0;
const server = () => ({ name: "test", url: `https://mcp${++serverCount}.example/mcp`, enabled: true });

async function callTool(tools: Record<string, unknown>, name: string, args: unknown) {
  const execute = (tools[name] as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute;
  return execute(args, { toolCallId: "1", messages: [] });
}

afterEach(() => vi.unstubAllGlobals());

describe("rawLoader — modern servers (2026-07-28)", () => {
  it("lists tools statelessly with _meta and request headers, no initialize", async () => {
    const calls = stubServer(() => json({ jsonrpc: "2.0", id: 1, result: { tools: [searchTool] } }));
    const { tools } = await rawLoader(server());

    expect(Object.keys(tools)).toEqual(["search"]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.body?.method).toBe("tools/list");
    expect(call.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(call.headers["mcp-method"]).toBe("tools/list");
    expect(call.headers["mcp-session-id"]).toBeUndefined();
    expect(call.body?.params?._meta).toMatchObject({
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    });
  });

  it("sends Mcp-Name on tools/call, base64-encoding unsafe names", async () => {
    const calls = stubServer((call) =>
      call.body?.method === "tools/list"
        ? json({ result: { tools: [searchTool, { ...searchTool, name: "héllo" }] } })
        : json({ result: { resultType: "complete", content: [{ type: "text", text: "ok" }] } })
    );
    const { tools } = await rawLoader(server());

    await expect(callTool(tools, "search", { q: "x" })).resolves.toEqual([{ type: "text", text: "ok" }]);
    expect(calls[1].headers["mcp-name"]).toBe("search");
    await callTool(tools, "héllo", {});
    expect(calls[2].headers["mcp-name"]).toBe(`=?base64?${btoa("h\xc3\xa9llo")}?=`);
  });

  it("does not fall back to initialize on a modern error", async () => {
    const calls = stubServer(() =>
      json({ jsonrpc: "2.0", id: 1, error: { code: -32020, message: "Header mismatch" } }, 400)
    );
    await expect(rawLoader(server())).rejects.toThrow(/-32020/);
    expect(calls.map((c) => c.body?.method)).toEqual(["tools/list"]);
  });

  it("rejects input_required results it cannot answer", async () => {
    stubServer((call) =>
      call.body?.method === "tools/list"
        ? json({ result: { tools: [searchTool] } })
        : json({ result: { resultType: "input_required", inputRequests: {} } })
    );
    const { tools } = await rawLoader(server());
    await expect(callTool(tools, "search", {})).rejects.toThrow(/multi round-trip/);
  });
});

describe("rawLoader — x-mcp-header", () => {
  const regionTool = {
    name: "sql",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", "x-mcp-header": "Region" },
        opts: { type: "object", properties: { dry: { type: "boolean", "x-mcp-header": "Dry" } } },
      },
    },
  };

  it("mirrors annotated params into Mcp-Param-* headers", async () => {
    const calls = stubServer((call) =>
      call.body?.method === "tools/list"
        ? json({ result: { tools: [regionTool] } })
        : json({ result: { content: [] } })
    );
    const { tools } = await rawLoader(server());
    await callTool(tools, "sql", { region: " us-west1", opts: { dry: false } });

    expect(calls[1].headers["mcp-param-region"]).toBe(`=?base64?${btoa(" us-west1")}?=`);
    expect(calls[1].headers["mcp-param-dry"]).toBe("false");
  });

  it("drops tools with invalid annotations and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = (name: string, inputSchema: Record<string, unknown>) => ({ name, inputSchema });
    stubServer(() =>
      json({
        result: {
          tools: [
            searchTool,
            bad("number", { properties: { n: { type: "number", "x-mcp-header": "N" } } }),
            bad("items", { properties: { a: { type: "array", items: { type: "string", "x-mcp-header": "A" } } } }),
            bad("dupe", {
              properties: {
                a: { type: "string", "x-mcp-header": "X" },
                b: { type: "string", "x-mcp-header": "x" },
              },
            }),
            bad("token", { properties: { a: { type: "string", "x-mcp-header": "Bad Name" } } }),
          ],
        },
      })
    );
    const { tools } = await rawLoader(server());

    expect(Object.keys(tools)).toEqual(["search"]);
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe("rawLoader — legacy fallback (2025-11-25)", () => {
  /** A legacy server shaped like DeepWiki's real response to a modern request. */
  function legacyServer() {
    return stubServer((call) => {
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      if (call.body?.params?._meta) {
        return json(
          { jsonrpc: "2.0", id: "server-error", error: { code: -32600, message: "Bad Request: Unsupported protocol version: 2026-07-28" } },
          400
        );
      }
      if (call.body?.method === "initialize") {
        return json({ result: { protocolVersion: "2025-11-25" } }, 200, { "mcp-session-id": "sess-1" });
      }
      if (call.body?.method === "notifications/initialized") return new Response(null, { status: 202 });
      return json({ result: { tools: [searchTool] } });
    });
  }

  it("falls back to initialize + session when the server rejects a modern request", async () => {
    const calls = legacyServer();
    const { tools, close } = await rawLoader(server());

    expect(Object.keys(tools)).toEqual(["search"]);
    expect(calls.map((c) => c.body?.method ?? c.method)).toEqual([
      "tools/list",
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(calls[1].body?.params?.protocolVersion).toBe("2025-11-25");
    expect(calls[3].headers["mcp-session-id"]).toBe("sess-1");
    expect(calls[3].body?.params?._meta).toBeUndefined();

    await close();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", headers: { "mcp-session-id": "sess-1" } });
  });

  it("remembers a legacy server and skips the modern probe next time", async () => {
    const config = server();
    legacyServer();
    await rawLoader(config);

    const calls = legacyServer();
    await rawLoader(config);
    expect(calls.map((c) => c.body?.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("falls back when a modern-looking version error lists no modern version", async () => {
    const calls = stubServer((call) => {
      if (call.body?.params?._meta) {
        return json(
          { error: { code: -32022, message: "Unsupported", data: { supported: ["2025-11-25"], requested: "2026-07-28" } } },
          400
        );
      }
      if (call.body?.method === "notifications/initialized") return new Response(null, { status: 202 });
      return json({ result: { tools: [] } });
    });
    await rawLoader(server());
    expect(calls[1].body?.method).toBe("initialize");
  });

  it("does not fall back on a server error (5xx)", async () => {
    const calls = stubServer(() => new Response("boom", { status: 503 }));
    await expect(rawLoader(server())).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(1);
  });
});
