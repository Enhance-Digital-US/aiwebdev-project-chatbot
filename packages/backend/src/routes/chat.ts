import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ToolSet,
} from "ai";
import type { AppEnv } from "../types";
import { DEFAULT_MODEL, getModel } from "../providers";
import { tools } from "../tools";
import { loadMcpTools } from "../mcp";
import type { McpElicitation } from "../mcp/types";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "../prompts/system";
import { flushTelemetry } from "../telemetry";
import { generateFollowups, isFirstExchange } from "../structured/followups";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = DEFAULT_MODEL, id: rawChatId } = await c.req.json();
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);
  const userId = c.get("userId");
  const chatId = typeof rawChatId === "string" && rawChatId.length <= 200 ? rawChatId : undefined;
  const supportsTools = config.supportsTools !== false;

  // Bound once the UI stream exists; MCP tools only ask for confirmation
  // while that stream is being consumed (design §6).
  let showElicitation: (elicitation: McpElicitation) => void = () => {};

  let mcpTools: ToolSet = {};
  let closeMcp = async () => {};
  if (supportsTools) {
    try {
      ({ tools: mcpTools, close: closeMcp } = await loadMcpTools(c.env, {
        userId,
        // Not the request host: wrangler dev rewrites it to the route's domain.
        local: c.env.ENVIRONMENT === "development",
      }, {
        onElicitation: (elicitation) => showElicitation(elicitation),
      }));
    } catch (error) {
      console.error("MCP tool loading failed, using local tools only:", error);
    }
  }

  const model = config.createModel(c.env);
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: modelMessages,
    providerOptions: config.providerOptions,
    ...(supportsTools && {
      tools: { ...tools, ...mcpTools },
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
      showElicitation = (elicitation) =>
        writer.write({ type: "data-mcp-elicitation", id: elicitation.toolCallId, data: elicitation });
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendReasoning: config.sendReasoning,
          sendFinish: false,
          // Continuing after a confirmation must reuse the paused assistant
          // message's id, or the client renders the answer as a second message.
          originalMessages: messages,
        })
      );

      // Once the answer is complete, add follow-ups (and a title on the first
      // exchange) to the same assistant message, then finish it.
      const { messages: answer } = await result.response;
      // Paused for a confirmation: the answer isn't finished, so no follow-ups
      // (a chip sent now would orphan the pending tool call).
      const awaitingApproval = answer.some(
        (m) => typeof m.content !== "string" && m.content.some((p) => p.type === "tool-approval-request")
      );
      if (awaitingApproval) {
        writer.write({ type: "finish" });
        return;
      }
      const withTitle = isFirstExchange(messages);
      const followups = await generateFollowups({
        model,
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
