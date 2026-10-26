import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";

// The chat route's imports reach workerd-only modules; stub them for unit tests.
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

// An in-memory chat table: id → owner and token total.
const table = vi.hoisted(() => new Map<string, { owner: string; tokenTotal: number }>());
const loadMcpTools = vi.hoisted(() => vi.fn());
vi.mock("../mcp", () => ({ loadMcpTools }));
// Tools and skills load the sandbox SDK and raw SKILL.md imports, neither of which runs here.
vi.mock("../tools", () => ({ tools: {}, createExecuteCodeTool: vi.fn(), createFileBugReportTool: vi.fn() }));
vi.mock("../skills", () => ({ loadSkill: {} }));
vi.mock("../chats/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chats/store")>();
  return {
    ...actual,
    claimChat: async (_db: unknown, id: string, owner: string) => {
      if (!table.has(id)) table.set(id, { owner, tokenTotal: 0 });
      const row = table.get(id)!;
      return row.owner === owner ? { owned: true, tokenTotal: row.tokenTotal } : { owned: false };
    },
    loadChat: async (_db: unknown, id: string, owner: string) =>
      table.get(id)?.owner === owner ? { id, title: "Saved", messages: [] } : null,
    listChats: async (_db: unknown, owner: string) =>
      [...table].filter(([, row]) => row.owner === owner).map(([id]) => ({ id, title: "Saved", updatedAt: 0 })),
  };
});

const { default: chatRoutes, BUDGET_MESSAGE } = await import("./chat");
const { default: chatsRoutes } = await import("./chats");
const { chatOwner, LOCAL_OWNER } = await import("../chats/store");

function app(caller: string | null, environment: "development" | "production", vars: Record<string, unknown> = {}) {
  const hono = new Hono<AppEnv>();
  hono.use("*", async (c, next) => {
    c.set("userId", caller);
    await next();
  });
  hono.route("/api", chatRoutes);
  hono.route("/api", chatsRoutes);
  const env = { ENVIRONMENT: environment, DB: {}, ...vars };
  return {
    get: (path: string) => hono.request(path, {}, env),
    send: (id: string) =>
      hono.request(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({ id, messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }] }),
        },
        env
      ),
  };
}

describe("chatOwner", () => {
  it("is the verified identity, the local user in development, else nobody", () => {
    expect(chatOwner("bob@example.com", false)).toBe("bob@example.com");
    expect(chatOwner(null, true)).toBe(LOCAL_OWNER);
    expect(chatOwner(null, false)).toBeNull();
  });
});

describe("ownership", () => {
  table.set("bobs-chat", { owner: "bob@example.com", tokenTotal: 0 });

  it("refuses to read another user's conversation", async () => {
    expect((await app("bob@example.com", "production").get("/api/chats/bobs-chat")).status).toBe(200);
    expect((await app("carol@example.com", "production").get("/api/chats/bobs-chat")).status).toBe(404);
    expect((await app(null, "production").get("/api/chats/bobs-chat")).status).toBe(404);
  });

  it("lists only the caller's conversations", async () => {
    const list = await (await app("carol@example.com", "production").get("/api/chats")).json();
    expect(list).toEqual([]);
  });

  it("refuses to continue another user's conversation, before any tool or model is used", async () => {
    const res = await app("carol@example.com", "production").send("bobs-chat");
    expect(res.status).toBe(404);
    expect(loadMcpTools).not.toHaveBeenCalled();
    expect(table.get("bobs-chat")!.owner).toBe("bob@example.com");
  });
});

describe("token cap", () => {
  it("refuses a conversation at its cap without calling a model", async () => {
    table.set("spent", { owner: LOCAL_OWNER, tokenTotal: 5000 });
    const res = await app(null, "development", { CHAT_TOKEN_CAP: "5000" }).send("spent");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: BUDGET_MESSAGE });
    expect(loadMcpTools).not.toHaveBeenCalled();
  });
});
