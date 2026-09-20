import { Hono } from "hono";
import {
  convertToModelMessages,
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
import { loadSkill, buildSkillsPrompt } from "../skills";
import { flushTelemetry } from "../telemetry";
import { createGuardrails } from "../guardrails";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = "gpt-4o-mini" } = await c.req.json();
  const config = getModel(modelId);
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

  const skillsPrompt = buildSkillsPrompt();

  const guardrails = createGuardrails(c.env);
  const baseModel = config.createModel(c.env);
  const model = guardrails
    ? wrapLanguageModel({
        model: baseModel as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: guardrails,
      })
    : baseModel;

  const result = streamText({
    model,
    system: `You are a helpful assistant.\n\n${skillsPrompt}`,
    messages: await convertToModelMessages(messages),
    providerOptions: config.providerOptions,
    ...(supportsTools && {
      tools: { ...tools, ...mcpTools, loadSkill, executeCode: createExecuteCodeTool(c.env) },
      stopWhen: isStepCount(5),
    }),
    telemetry: { functionId: config.telemetryId },
    onEnd() {
      c.executionCtx.waitUntil(Promise.all([closeMcp(), flushTelemetry()]));
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: config.sendReasoning,
    }),
  });
});

export default chat;
