import { Hono } from "hono";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppEnv } from "../types";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages } = await c.req.json();
  const openai = createOpenAI({ apiKey: c.env.OPENAI_API_KEY });

  const result = streamText({
    model: openai("gpt-6-luna"),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});

export default chat;
