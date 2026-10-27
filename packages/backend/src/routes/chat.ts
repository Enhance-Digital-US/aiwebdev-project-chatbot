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
import { buildSystemPrompt } from "../prompts/system";
import { generateFollowups, isFirstExchange } from "../structured/followups";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = DEFAULT_MODEL } = await c.req.json();
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);

  const model = config.createModel(c.env);
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: modelMessages,
    providerOptions: config.providerOptions,
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
