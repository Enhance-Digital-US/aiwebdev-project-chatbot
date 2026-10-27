import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevTokenSource, type CredentialContext } from "./credentials";
import type { AppEnv } from "../types";

const tokenUrl = "http://localhost:8787/auth/dev-token";

function stubTokenEndpoint() {
  let minted = 0;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    minted++;
    const { sub, scope } = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({ access_token: `tok-${sub}-${scope}-${minted}`, token_type: "Bearer", expires_in: 3600 }),
      { headers: { "content-type": "application/json" } }
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ctx = (vars: Partial<AppEnv["Bindings"]> = {}, local = true): CredentialContext => ({
  env: vars as AppEnv["Bindings"],
  userId: null,
  local,
});

afterEach(() => vi.unstubAllGlobals());

describe("dev-token credential source", () => {
  it("mints a token for user-bob (member) on first use by default", async () => {
    const fetchMock = stubTokenEndpoint();
    const source = createDevTokenSource({ tokenUrl, now: () => 0 });

    expect(await source(ctx())).toEqual({ authorization: "Bearer tok-user-bob-member-1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(tokenUrl);
  });

  it("reuses the token until 60 s before expiry, then re-mints", async () => {
    const fetchMock = stubTokenEndpoint();
    let t = 0;
    const source = createDevTokenSource({ tokenUrl, now: () => t });

    await source(ctx());
    t = 3600_000 - 60_001; // just inside the margin
    expect(await source(ctx())).toEqual({ authorization: "Bearer tok-user-bob-member-1" });
    expect(fetchMock).toHaveBeenCalledOnce();

    t = 3600_000 - 60_000; // margin reached
    expect(await source(ctx())).toEqual({ authorization: "Bearer tok-user-bob-member-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the configured persona's role", async () => {
    stubTokenEndpoint();
    const source = createDevTokenSource({ tokenUrl, now: () => 0 });
    expect(await source(ctx({ ISSUE_TRACKER_PERSONA: "user-carol" }))).toEqual({
      authorization: "Bearer tok-user-carol-viewer-1",
    });
  });

  it("rejects an unknown persona", async () => {
    stubTokenEndpoint();
    const source = createDevTokenSource({ tokenUrl });
    await expect(source(ctx({ ISSUE_TRACKER_PERSONA: "user-mallory" }))).rejects.toThrow(/Unknown/);
  });

  it("is unavailable when not running locally", async () => {
    const fetchMock = stubTokenEndpoint();
    const source = createDevTokenSource({ tokenUrl });
    expect(await source(ctx({}, false))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
