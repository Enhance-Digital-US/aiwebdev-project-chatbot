import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import { accessTokenFor, createOAuthSource, isConnected, loadTokens, saveTokens } from "./tokens";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const TRACKER = "http://tracker.test";
const RESOURCE = `${TRACKER}/mcp`;
const HOUR = 3_600_000;

type Row = Record<string, unknown>;

/** The issue_tracker_tokens table, for the statements tokens.ts runs (prepare → bind → first/run). */
function fakeD1() {
  const rows = new Map<string, Row>();
  const columns = ["user_id", "client_id", "access_token_enc", "refresh_token_enc", "expires_at", "updated_at"];
  const statement = (sql: string, p: unknown[] = []) => ({
    bind: (...args: unknown[]) => statement(sql, args),
    first: async () => rows.get(p[0] as string) ?? null,
    run: async () => {
      const owner = p[0] as string;
      if (sql.startsWith("INSERT")) rows.set(owner, Object.fromEntries(columns.map((c, i) => [c, p[i]])));
      // DELETE … WHERE user_id = ? [AND refresh_token_enc IS ?]
      else if (p.length === 1 || rows.get(owner)?.refresh_token_enc === p[1]) rows.delete(owner);
    },
  });
  return { rows, d1: { prepare: (sql: string) => statement(sql) } as unknown as D1Database };
}

/** The tracker's discovery documents and token endpoint. */
function stubTracker(token: (grant: URLSearchParams) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${TRACKER}/.well-known/oauth-protected-resource/mcp`) {
      return Response.json({ resource: RESOURCE, authorization_servers: [TRACKER] });
    }
    if (url === `${TRACKER}/.well-known/oauth-authorization-server`) {
      return Response.json({
        issuer: TRACKER,
        authorization_endpoint: `${TRACKER}/authorize`,
        token_endpoint: `${TRACKER}/oauth/token`,
        registration_endpoint: `${TRACKER}/oauth/register`,
        client_id_metadata_document_supported: true,
      });
    }
    if (url === `${TRACKER}/oauth/token`) return token(new URLSearchParams(String(init?.body)));
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const tokenCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/oauth/token"));
  return { fetchMock, tokenCalls };
}

let db: ReturnType<typeof fakeD1>;
let env: AppEnv["Bindings"];

beforeEach(() => {
  db = fakeD1();
  env = { DB: db.d1, TOKEN_ENCRYPTION_KEY: KEY } as AppEnv["Bindings"];
});
afterEach(() => vi.unstubAllGlobals());

const connect = (owner: string, accessToken: string, refreshToken: string | undefined, expiresAt: number) =>
  saveTokens(env, owner, "client-1", { accessToken, refreshToken, expiresAt }, 0);

describe("issue-tracker token store", () => {
  it("stores tokens encrypted and reads them back", async () => {
    await connect("alice", "access-1", "refresh-1", HOUR);
    expect(JSON.stringify(db.rows.get("alice"))).not.toMatch(/access-1|refresh-1/);
    expect(await loadTokens(env, "alice")).toMatchObject({
      clientId: "client-1",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: HOUR,
    });
    expect(await isConnected(env.DB, "alice")).toBe(true);
    expect(await isConnected(env.DB, "bob")).toBe(false);
  });

  it("won't decrypt one user's row as another's", async () => {
    await connect("alice", "access-1", "refresh-1", HOUR);
    db.rows.set("mallory", db.rows.get("alice")!);
    await expect(loadTokens(env, "mallory")).rejects.toThrow();
  });
});

describe("access tokens with refresh on expiry", () => {
  it("uses the stored token while it's valid, without calling the tracker", async () => {
    const { fetchMock } = stubTracker(() => new Response("unexpected", { status: 500 }));
    await connect("alice", "access-1", "refresh-1", HOUR);
    expect(await accessTokenFor(env, "alice", RESOURCE, () => HOUR - 61_000)).toBe("access-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token for the same client and resource, and saves the rotated tokens", async () => {
    const { tokenCalls } = stubTracker(() =>
      Response.json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })
    );
    await connect("alice", "access-1", "refresh-1", HOUR);

    const now = HOUR + 1;
    expect(await accessTokenFor(env, "alice", RESOURCE, () => now)).toBe("access-2");
    const grant = new URLSearchParams(String(tokenCalls()[0][1]?.body));
    expect(Object.fromEntries(grant)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "client-1",
      resource: RESOURCE,
    });
    expect(await loadTokens(env, "alice")).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: now + HOUR,
    });

    // The new token is used until it expires in turn.
    expect(await accessTokenFor(env, "alice", RESOURCE, () => now + 1000)).toBe("access-2");
    expect(tokenCalls()).toHaveLength(1);
  });

  it("keeps the refresh token when the server doesn't rotate it", async () => {
    stubTracker(() => Response.json({ access_token: "access-2", expires_in: 3600 }));
    await connect("alice", "access-1", "refresh-1", HOUR);
    await accessTokenFor(env, "alice", RESOURCE, () => HOUR + 1);
    expect((await loadTokens(env, "alice"))?.refreshToken).toBe("refresh-1");
  });

  it("disconnects the user when the refresh token is refused, so they're offered to connect", async () => {
    stubTracker(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await connect("alice", "access-1", "refresh-1", HOUR);
    expect(await accessTokenFor(env, "alice", RESOURCE, () => HOUR + 1)).toBeNull();
    expect(await isConnected(env.DB, "alice")).toBe(false);
  });

  it("uses another request's refresh when the refresh token was rotated meanwhile", async () => {
    stubTracker(async () => {
      // A concurrent request (say a workflow step) refreshed first and saved
      // its rotated tokens, so the refresh token we sent is refused.
      await saveTokens(env, "alice", "client-1", { accessToken: "access-other", refreshToken: "refresh-other", expiresAt: 3 * HOUR }, HOUR);
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });
    await connect("alice", "access-1", "refresh-1", HOUR);
    expect(await accessTokenFor(env, "alice", RESOURCE, () => HOUR + 1)).toBe("access-other");
    expect((await loadTokens(env, "alice"))?.refreshToken).toBe("refresh-other");
  });

  it("leaves the user connected when the tracker is down (the server is skipped this time)", async () => {
    stubTracker(() => new Response("down", { status: 503 }));
    await connect("alice", "access-1", "refresh-1", HOUR);
    await expect(accessTokenFor(env, "alice", RESOURCE, () => HOUR + 1)).rejects.toThrow("HTTP 503");
    expect(await isConnected(env.DB, "alice")).toBe(true);
  });
});

describe("OAuth credential source", () => {
  it("authorizes as the Access user, or the local owner in development", async () => {
    stubTracker(() => new Response("unexpected", { status: 500 }));
    await connect("alice@example.com", "access-alice", "r", HOUR);
    await connect("local", "access-local", "r", HOUR);
    const source = createOAuthSource({ resource: RESOURCE, now: () => 0 });

    expect(await source({ env, userId: "alice@example.com", local: false })).toEqual({
      authorization: "Bearer access-alice",
    });
    expect(await source({ env, userId: null, local: true })).toEqual({ authorization: "Bearer access-local" });
  });

  it("returns no credential when the user hasn't connected, or has no identity", async () => {
    const source = createOAuthSource({ resource: RESOURCE, now: () => 0 });
    expect(await source({ env, userId: "bob@example.com", local: false })).toBeNull();
    expect(await source({ env, userId: null, local: false })).toBeNull();
  });
});
