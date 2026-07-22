import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";

type Bindings = {
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["POST"],
    allowHeaders: ["Content-Type"],
  })
);

app.post("/api/chat", async (c) => {
  const openai = createOpenAI({ apiKey: c.env.OPENAI_API_KEY });
  const { messages } = await c.req.json();

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});

app.post("/api/ollama-chat", async (c) => {
  const ollama = createOllama({ baseURL: "http://localhost:11434/api" });
  const { messages } = await c.req.json();

  const result = streamText({
    model: ollama("gemma4:12b"),
    system: "You are a helpful assistant.",
    messages: await convertToModelMessages(messages),
    providerOptions: { ollama: { think: true } },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: true,
    }),
  });
});

export default app;
