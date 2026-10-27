import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, isStepCount, type ModelMessage, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { rawLoader } from "./raw-loader";

/** MRTR elicitation over AI SDK tool approval (design §6), across both requests. */

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that calls `toolName` once, then answers in text. */
function modelCalling(toolName: string, input: unknown, { skipToolCall = false } = {}) {
  let calls = skipToolCall ? 1 : 0;
  const prompts: ModelMessage[][] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt as ModelMessage[]);
      if (calls++ === 0) {
        return {
          content: [{ type: "tool-call", toolCallId: "tc1", toolName, input: JSON.stringify(input) }],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    },
  });
  return { model, prompts };
}

const deleteTool = {
  name: "delete_project",
  inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] },
};

const confirmRequest = {
  confirm: {
    method: "elicitation/create",
    params: {
      message: 'Delete project "Demo"?',
      requestedSchema: { type: "object", properties: { proceed: { type: "boolean" } }, required: ["proceed"] },
    },
  },
};

type Body = { method?: string; params?: Record<string, unknown> };

/** An issue-tracker-like server: delete_project asks to confirm, then honors the answer. */
function stubTracker(inputRequests: unknown = confirmRequest) {
  const calls: Body[] = [];
  let mint = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    calls.push(body);
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
    if (body.method === "tools/list") return reply({ tools: [deleteTool] });
    const responses = body.params?.inputResponses as Record<string, { action: string; content?: { proceed?: boolean } }> | undefined;
    if (!responses) {
      return reply({ resultType: "input_required", inputRequests, requestState: `state-${++mint}` });
    }
    const ok = responses.confirm?.action === "accept" && responses.confirm.content?.proceed === true;
    return reply({ resultType: "complete", content: [{ type: "text", text: ok ? "deleted" : "cancelled" }] });
  });
  return calls;
}

const toolCalls = (calls: Body[]) => calls.filter((c) => c.method === "tools/call");

async function firstRequest(tools: ToolSet) {
  const { model } = modelCalling("delete_project", { project_id: "p1" });
  const result = await generateText({ model, tools, prompt: "delete p1", stopWhen: isStepCount(3) });
  const request = result.content.find((p) => p.type === "tool-approval-request") as
    | { approvalId: string }
    | undefined;
  return { result, request };
}

async function secondRequest(tools: ToolSet, first: Awaited<ReturnType<typeof firstRequest>>, approved: boolean) {
  const { model, prompts } = modelCalling("delete_project", {}, { skipToolCall: true });
  const messages: ModelMessage[] = [
    { role: "user", content: "delete p1" },
    ...first.result.response.messages,
    {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: first.request!.approvalId,
          approved,
          ...(!approved && { reason: "The user cancelled this action." }),
        },
      ],
    },
  ];
  await generateText({ model, tools, messages });
  const toolMessages = prompts.at(-1)!.filter((m) => m.role === "tool");
  return toolMessages.flatMap((m) => (typeof m.content === "string" ? [] : m.content));
}

afterEach(() => vi.unstubAllGlobals());

describe("rawLoader — MRTR elicitation", () => {
  const server = () => ({ name: "issue-tracker", url: `https://tracker${Math.random()}.example/mcp`, enabled: true });

  it("pauses for confirmation, then retries with an accept and the fresh requestState", async () => {
    const calls = stubTracker();
    const onElicitation = vi.fn();
    const { tools } = await rawLoader(server(), { onElicitation });

    const first = await firstRequest(tools);
    expect(first.request).toBeDefined();
    expect(onElicitation).toHaveBeenCalledWith({
      toolCallId: "tc1",
      server: "issue-tracker",
      message: 'Delete project "Demo"?',
    });
    expect(toolCalls(calls)).toHaveLength(1);

    const results = await secondRequest(tools, first, true);
    // Request 2 doesn't re-probe in needsApproval: one call that mints a new
    // requestState, then the retry that answers it.
    expect(onElicitation).toHaveBeenCalledOnce();
    const [, mint, retry] = toolCalls(calls);
    expect(mint.params?.inputResponses).toBeUndefined();
    expect(retry.params).toMatchObject({
      name: "delete_project",
      arguments: { project_id: "p1" },
      inputResponses: { confirm: { action: "accept", content: { proceed: true } } },
      requestState: "state-2",
    });
    expect(results).toContainEqual(
      expect.objectContaining({ type: "tool-result", output: { type: "json", value: [{ type: "text", text: "deleted" }] } })
    );
  });

  it("on cancel, makes no further server call and tells the model", async () => {
    const calls = stubTracker();
    const { tools } = await rawLoader(server());

    const first = await firstRequest(tools);
    const results = await secondRequest(tools, first, false);

    expect(toolCalls(calls)).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        output: { type: "execution-denied", reason: "The user cancelled this action." },
      })
    );
  });

  it("calls a tool that needs no input exactly once", async () => {
    const calls = stubTracker();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Body;
      calls.push(body);
      const result = body.method === "tools/list" ? { tools: [deleteTool] } : { content: [{ type: "text", text: "done" }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
    });
    const { tools } = await rawLoader(server());

    const { result, request } = await firstRequest(tools);
    expect(request).toBeUndefined();
    expect(toolCalls(calls)).toHaveLength(1);
    expect(result.text).toBe("ok");
  });

  it("fails the call on an unsupported input request, naming it", async () => {
    stubTracker({ ask: { method: "sampling/createMessage", params: {} } });
    const { tools } = await rawLoader(server());

    const { result } = await firstRequest(tools);
    const error = result.steps[0].content.find((p) => p.type === "tool-error") as { error: Error } | undefined;
    expect(String(error?.error)).toMatch(/does not support: sampling\/createMessage/);
  });

  it("fails the call on an elicitation form it can't render as a confirmation", async () => {
    stubTracker({
      name: {
        method: "elicitation/create",
        params: { message: "Name?", requestedSchema: { type: "object", properties: { name: { type: "string" } } } },
      },
    });
    const { tools } = await rawLoader(server());

    const { result } = await firstRequest(tools);
    const error = result.steps[0].content.find((p) => p.type === "tool-error") as { error: Error } | undefined;
    expect(String(error?.error)).toMatch(/form this client does not support \(fields: name\)/);
  });
});
