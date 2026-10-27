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
import { DEFAULT_MODEL, getModel } from "../providers";
import { tools, createExecuteCodeTool, createFileBugReportTool } from "../tools";
import { loadMcpTools } from "../mcp";
import { issueTrackerAuth } from "../mcp/config";
import { isConnected } from "../oauth/tokens";
import type { McpElicitation } from "../mcp/types";
import { loadSkill } from "../skills";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "../prompts/system";
import { flushTelemetry } from "../telemetry";
import { createGuardrails } from "../guardrails";
import { generateFollowups, wantsTitle } from "../structured/followups";
import { chatOwner, claimChat, saveChat } from "../chats/store";

const chat = new Hono<AppEnv>();

chat.post("/chat", async (c) => {
  const { messages, model: modelId = DEFAULT_MODEL, id: rawChatId } = (await c.req.json()) as {
    messages: UIMessage[];
    model?: string;
    id?: unknown;
  };
  const config = getModel(modelId);
  if (!config) return c.json({ error: `Unknown model: ${modelId}` }, 400);
  const userId = c.get("userId");
  const chatId = typeof rawChatId === "string" && rawChatId.length <= 200 ? rawChatId : undefined;
  const supportsTools = config.supportsTools !== false;

  // Requests with a chat id are saved to it (design §8); ones without (evals,
  // smoke tests) aren't. Ownership is checked before any tool or model is
  // touched.
  const owner = chatOwner(userId, c.env.ENVIRONMENT === "development");
  const saveTo = chatId && owner ? chatId : undefined;
  let chatTitled: boolean | undefined;
  if (saveTo) {
    const claim = await claimChat(c.env.DB, saveTo, owner!);
    if (!claim.owned) return c.json({ error: "Chat not found" }, 404);
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

  // With per-user OAuth, a user who hasn't connected the issue tracker (or
  // whose refresh token just stopped working) is offered the connect link.
  const connectUrl =
    supportsTools && owner && issueTrackerAuth(c.env) === "oauth" && !(await isConnected(c.env.DB, owner))
      ? `/oauth/connect?return_to=${encodeURIComponent(chatId ? `/c/${chatId}` : "/")}`
      : undefined;

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

  const result = streamText({
    model: guarded(),
    system: buildSystemPrompt({ issueTrackerConnectUrl: connectUrl }),
    messages: modelMessages,
    providerOptions: config.providerOptions,
    ...(supportsTools && {
      tools: {
        ...tools,
        ...mcpTools,
        loadSkill,
        executeCode: createExecuteCodeTool(c.env),
        // Its workflow files with the user's issue-tracker credential.
        ...(!connectUrl && { fileBugReport: createFileBugReportTool(c.env, { userId, chatId }) }),
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

  const stream = createUIMessageStream({
    // With the original messages, onEnd gets the whole conversation, follow-ups
    // included, under the message id the client keeps.
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
      // Paused for a confirmation: the answer isn't finished, so no follow-ups
      // (a chip sent now would orphan the pending tool call).
      const awaitingApproval = answer.some(
        (m) => typeof m.content !== "string" && m.content.some((p) => p.type === "tool-approval-request")
      );
      if (awaitingApproval) {
        writer.write({ type: "finish" });
        return;
      }
      const withTitle = wantsTitle(messages, chatTitled);
      const followups = await generateFollowups({
        model: guarded(),
        messages: [...modelMessages, ...answer],
        withTitle,
      });
      if (followups) writer.write({ type: "data-followups", data: followups });
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
