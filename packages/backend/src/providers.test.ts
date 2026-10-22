import { afterEach, describe, expect, it, vi } from "vitest";
import { availableModels, getModel } from "./providers";
import type { AppEnv } from "./types";

const env = {
  OPENAI_API_KEY: "sk-test",
  AI_GATEWAY_ACCOUNT_ID: "acct123",
  AI_GATEWAY_NAME: "chatbot",
  AI_GATEWAY_TOKEN: "gw-token",
} as AppEnv["Bindings"];

afterEach(() => vi.unstubAllGlobals());

describe("model registry", () => {
  it("lists the OpenAI and Ollama models", () => {
    expect(availableModels).toEqual(["gpt-4o-mini", "gemma4:12b"]);
  });

  it("rejects unknown and prototype keys", () => {
    expect(getModel("gpt-5")).toBeUndefined();
    expect(getModel("toString")).toBeUndefined();
  });

  it("sends OpenAI calls through the AI Gateway with the gateway token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const model = getModel("gpt-4o-mini")!.createModel(env);
    await (model as unknown as { doGenerate: (o: unknown) => Promise<unknown> })
      .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
      .catch(() => {});

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/acct123\/chatbot\/openai\//);
    const headers = new Headers(init.headers);
    expect(headers.get("cf-aig-authorization")).toBe("Bearer gw-token");
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });
});
