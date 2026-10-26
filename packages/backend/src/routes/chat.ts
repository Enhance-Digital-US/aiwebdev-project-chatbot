import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type ToolSet,
} from "ai";
import type { AppEnv } from "../types";
import { getModel } from "../providers";
import { tools, createExecuteCodeTool } from "../tools";
import { loadMcpTools } from "../mcp";
import { loadSkill } from "../skills";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "../prompts/system";
import { flushTelemetry } from "../telemetry";
import { createGuardrails } from "../guardrails";
import { generateFollowups, isFirstExchange } from "../structured/followups";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = "gpt-4o-mini", id: rawChatId } = await c.req.json();
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);
  const userId = c.get("userId");
  const chatId = typeof rawChatId === "string" && rawChatId.length <= 200 ? rawChatId : undefined;
  const supportsTools = config.supportsTools !== false;

  let mcpTools: ToolSet = {};
  let closeMcp = async () => {};
  if (supportsTools) {
    try {
      ({ tools: mcpTools, close: closeMcp } = await loadMcpTools(c.env));
    } catch (error) {
      console.error("MCP tool loading failed, using local tools only:", error);
    }
  }

  const baseModel = config.createModel(c.env);
  // Each call gets its own guardrail instance: the middleware tracks which
  // messages it has already checked.
  const guarded = () => {
    const guardrails = createGuardrails(c.env);
    return guardrails
      ? wrapLanguageModel({
          model: baseModel as Parameters<typeof wrapLanguageModel>[0]["model"],
          middleware: guardrails,
        })
      : baseModel;
  };
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: guarded(),
    system: buildSystemPrompt(),
    messages: modelMessages,
    providerOptions: config.providerOptions,
    ...(supportsTools && {
      tools: { ...tools, ...mcpTools, loadSkill, executeCode: createExecuteCodeTool(c.env) },
      stopWhen: isStepCount(5),
    }),
    runtimeContext: {
      promptVersion: SYSTEM_PROMPT_VERSION,
      ...(chatId && { sessionId: chatId }),
      ...(userId && { userId }),
    },
    telemetry: {
      functionId: config.telemetryId,
      includeRuntimeContext: { sessionId: true, userId: true, promptVersion: true },
    },
    onEnd() {
      c.executionCtx.waitUntil(Promise.all([closeMcp(), flushTelemetry()]));
    },
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendReasoning: config.sendReasoning,
          sendFinish: false,
        })
      );

      // Once the answer is complete, add follow-ups (and a title on the first
      // exchange) to the same assistant message, then finish it.
      const { messages: answer } = await result.response;
      const withTitle = isFirstExchange(messages);
      const followups = await generateFollowups({
        model: guarded(),
        messages: [...modelMessages, ...answer],
        withTitle,
      });
      if (followups) writer.write({ type: "data-followups", data: followups });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
});

export default chat;
