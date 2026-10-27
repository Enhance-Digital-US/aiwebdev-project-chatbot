import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import type { AppEnv } from "../types";
import { DEFAULT_MODEL, getModel } from "../providers";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = DEFAULT_MODEL } = await c.req.json();
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);

  const model = config.createModel(c.env);

  const result = streamText({
    model,
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});

export default chat;
