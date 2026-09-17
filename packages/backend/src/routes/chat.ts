import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import type { AppEnv } from "../types";
import { getModel } from "../providers";
import { tools } from "../tools";
import { flushTelemetry } from "../telemetry";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = "gpt-4o-mini" } = await c.req.json();
  const config = getModel(modelId);

  const result = streamText({
    model: config.createModel(c.env),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
    providerOptions: config.providerOptions,
    ...(config.supportsTools !== false && { tools, stopWhen: isStepCount(2) }),
    telemetry: { functionId: config.telemetryId },
    onEnd() {
      c.executionCtx.waitUntil(flushTelemetry());
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
