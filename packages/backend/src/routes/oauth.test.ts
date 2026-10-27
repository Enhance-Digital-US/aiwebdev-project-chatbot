import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import oauthRoutes, { safeReturnTo } from "./oauth";
import { encrypt } from "../oauth/crypto";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const env = {
  APP_URL: "https://chatbot.example",
  ENVIRONMENT: "development",
  TOKEN_ENCRYPTION_KEY: KEY,
} as AppEnv["Bindings"];

const app = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.set("userId", null);
    await next();
  })
  .route("/oauth", oauthRoutes);

describe("issue-tracker OAuth routes", () => {
  it("serves the client metadata document under its own URL", async () => {
    const res = await app.request("/oauth/client-metadata.json", {}, env);
    expect(await res.json()).toMatchObject({
      client_id: "https://chatbot.example/oauth/client-metadata.json",
      redirect_uris: ["https://chatbot.example/oauth/callback"],
      token_endpoint_auth_method: "none",
    });
  });

  it("refuses a callback without the login cookie", async () => {
    const res = await app.request("/oauth/callback?state=s&code=c", {}, env);
    expect(res.status).toBe(400);
  });

  it("refuses a callback whose cookie wasn't sealed by this server", async () => {
    const res = await app.request(
      "/oauth/callback?state=s&code=c",
      { headers: { cookie: "issue_tracker_oauth=bm90LXNlYWxlZA==" } },
      env
    );
    expect(res.status).toBe(400);
  });

  it("refuses a callback whose state doesn't match the login it started", async () => {
    const pending = { state: "right", verifier: "v", clientId: "c", issuer: "i", owner: "local", returnTo: "/", expiresAt: Date.now() + 60_000 };
    const cookie = encodeURIComponent(await encrypt(KEY, JSON.stringify(pending), "oauth-state"));
    const res = await app.request("/oauth/callback?state=wrong&code=c", { headers: { cookie: `issue_tracker_oauth=${cookie}` } }, env);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("doesn't match");
  });

  it("only returns to paths on this site", () => {
    expect(safeReturnTo("/c/abc")).toBe("/c/abc");
    expect(safeReturnTo("//evil.example/x")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});
