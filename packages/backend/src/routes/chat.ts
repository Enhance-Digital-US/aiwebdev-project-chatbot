import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import type { AppEnv } from "../types";
import { DEFAULT_MODEL, getModel } from "../providers";
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

  const model = config.createModel(c.env);
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: modelMessages,
    providerOptions: config.providerOptions,
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
      c.executionCtx.waitUntil(flushTelemetry());
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
