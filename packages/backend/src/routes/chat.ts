import { Hono } from "hono";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type ToolSet,
  type UIMessage,
} from "ai";
import type { AppEnv } from "../types";
import { getModel } from "../providers";
import { tools, createExecuteCodeTool, createFileBugReportTool } from "../tools";
import { loadMcpTools } from "../mcp";
import type { McpElicitation } from "../mcp/types";
import { loadSkill } from "../skills";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "../prompts/system";
import { flushTelemetry } from "../telemetry";
import { createGuardrails } from "../guardrails";
import { generateFollowups, wantsTitle } from "../structured/followups";
import { chatOwner, claimChat, saveChat } from "../chats/store";
import { addUsage, messageUsage, tokenCount, type MessageUsage, type ModelCall } from "../usage";

const chat = new Hono<AppEnv>();

/** Assistant message metadata (the frontend's cost meter reads it). */
export type ChatMetadata = { usage: MessageUsage };

export const BUDGET_MESSAGE =
  "This conversation has used its token budget. Start a new conversation to keep going.";

/** Seconds AI Gateway may serve a repeated request from its cache (design §10). */
const GATEWAY_CACHE_TTL = "3600";

chat.post("/chat", async (c) => {
  const { messages, model: modelId = "gpt-4o-mini", id: rawChatId } = (await c.req.json()) as {
    messages: UIMessage<ChatMetadata>[];
    model?: string;
    id?: unknown;
  };
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);
  const userId = c.get("userId");
  const chatId = typeof rawChatId === "string" && rawChatId.length <= 200 ? rawChatId : undefined;
  const supportsTools = config.supportsTools !== false;

  // Requests with a chat id are saved to it (design §8); ones without (evals,
  // smoke tests) aren't. Ownership and the token cap are checked before any
  // tool or model is touched.
  const owner = chatOwner(userId, c.env.ENVIRONMENT === "development");
  const saveTo = chatId && owner ? chatId : undefined;
  let chatTitled: boolean | undefined;
  if (saveTo) {
    const claim = await claimChat(c.env.DB, saveTo, owner!);
    if (!claim.owned) return c.json({ error: "Chat not found" }, 404);
    const cap = Number(c.env.CHAT_TOKEN_CAP);
    if (cap > 0 && claim.tokenTotal >= cap) return c.json({ error: BUDGET_MESSAGE }, 429);
    chatTitled = claim.titled;
  }

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
  // Repeats of an identical request (same conversation, prompt and tools) are
  // answered from the gateway's cache.
  const headers = config.gateway ? { "cf-aig-cache-ttl": GATEWAY_CACHE_TTL } : undefined;

  const result = streamText({
    model: guarded(),
    system: buildSystemPrompt(),
    messages: modelMessages,
    providerOptions: config.providerOptions,
    headers,
    ...(supportsTools && {
      tools: {
        ...tools,
        ...mcpTools,
        loadSkill,
        executeCode: createExecuteCodeTool(c.env),
        fileBugReport: createFileBugReportTool(c.env, { userId, chatId }),
      },
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

  // Usage of this request; the save adds it to the chat's token total.
  let requestUsage: MessageUsage | undefined;

  const stream = createUIMessageStream<UIMessage<ChatMetadata>>({
    // With the original messages, onEnd gets the whole conversation, follow-ups
    // and metadata included, under the message id the client keeps.
    originalMessages: messages,
    onEnd: async ({ messages: conversation, responseMessage }) => {
      if (!saveTo) return;
      const followups = responseMessage.parts.find((p) => p.type === "data-followups") as
        | { data: { title?: string } }
        | undefined;
      try {
        await saveChat(c.env.DB, saveTo, {
          messages: conversation,
          title: followups?.data.title,
          tokens: requestUsage ? tokenCount(requestUsage) : 0,
        });
      } catch (error) {
        console.error("Saving the chat failed:", error);
      }
    },
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
      const calls: ModelCall[] = (await result.steps).map((step) => ({
        usage: step.usage,
        headers: step.response.headers,
      }));
      // Usage covers every model call behind the message, so it matches the
      // gateway's logs. A continuation after a confirmation adds to the
      // paused half's usage rather than replacing it.
      const sendUsage = () => {
        requestUsage = messageUsage(calls, config.price);
        const previous = messages.at(-1)?.role === "assistant" ? messages.at(-1)?.metadata?.usage : undefined;
        writer.write({
          type: "message-metadata",
          messageMetadata: { usage: previous ? addUsage(previous, requestUsage) : requestUsage },
        });
      };
      // Paused for a confirmation: the answer isn't finished, so no follow-ups
      // (a chip sent now would orphan the pending tool call).
      const awaitingApproval = answer.some(
        (m) => typeof m.content !== "string" && m.content.some((p) => p.type === "tool-approval-request")
      );
      if (awaitingApproval) {
        sendUsage();
        writer.write({ type: "finish" });
        return;
      }
      const withTitle = wantsTitle(messages, chatTitled);
      const followups = await generateFollowups({
        model: guarded(),
        messages: [...modelMessages, ...answer],
        withTitle,
        headers,
        onCall: (call) => calls.push(call),
      });
      if (followups) writer.write({ type: "data-followups", data: followups });
      sendUsage();
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({
    stream,
    // Keep the stream running to the end when the client goes away, so the
    // conversation is still saved.
    consumeSseStream: ({ stream }) => c.executionCtx.waitUntil(consumeStream({ stream })),
  });
});

export default chat;
