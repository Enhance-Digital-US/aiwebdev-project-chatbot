import { Hono } from "hono";
import { cors } from "hono/cors";
import { convertToModelMessages, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

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

  return result.toUIMessageStreamResponse();
});

export default app;
