import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import type { ToolPart } from "@/components/ai-elements/tool";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabs,
} from "@/components/ai-elements/sandbox";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Confirmation } from "@/components/ai-elements/confirmation";
import { BugReportCard } from "@/components/ai-elements/bug-report-card";
import { Suggestions } from "@/components/ai-elements/suggestions";
import { sumUsage, useChatSession, type MessageUsage } from "@/lib/chat-session";
import {
  Tool as ToolDisplay,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

const models = [
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" as const },
  // Ollama runs on localhost — only offer it in dev builds
  ...(import.meta.env.DEV
    ? [{ id: "gemma4:12b", name: "Gemma 4 12B", provider: "google" as const }]
    : []),
];

function ToolInvocation({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (part.state === "output-available" || part.state === "output-error") {
      setOpen(true);
    }
  }, [part.state]);

  return (
    <ToolDisplay open={open} onOpenChange={setOpen}>
      {part.type === "dynamic-tool" ? (
        <ToolHeader type={part.type} state={part.state} toolName={part.toolName} />
      ) : (
        <ToolHeader type={part.type} state={part.state} />
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={part.state === "output-available" ? part.output : undefined}
          errorText={part.state === "output-error" ? part.errorText : undefined}
        />
      </ToolContent>
    </ToolDisplay>
  );
}

/** Sent by the backend after each answer (packages/backend/src/structured/followups.ts). */
type Followups = { suggestions: string[]; title?: string };
/** Sent when an MCP server pauses a tool call to ask the user (backend mcp/types.ts). */
type McpElicitation = { toolCallId: string; server: string; message: string };
/** Assistant message metadata: what the answer used (backend routes/chat.ts). */
type ChatMetadata = { usage?: MessageUsage };
type ChatMessage = UIMessage<ChatMetadata, { followups: Followups; "mcp-elicitation": McpElicitation }>;

function followupsOf(message: ChatMessage): Followups | undefined {
  for (const part of message.parts) {
    if (part.type === "data-followups") return part.data;
  }
  return undefined;
}

function elicitationFor(message: ChatMessage, toolCallId: string): McpElicitation | undefined {
  for (const part of message.parts) {
    if (part.type === "data-mcp-elicitation" && part.data.toolCallId === toolCallId) return part.data;
  }
  return undefined;
}

/** The backend answers refusals (e.g. the token budget) with `{ error }`; useChat passes the body on as the message. */
function errorText(error: Error): string {
  try {
    const { error: message } = JSON.parse(error.message) as { error?: string };
    if (message) return message;
  } catch {
    // not JSON: a network or stream error
  }
  return "Something went wrong. Try again.";
}

const isAwaitingApproval = (message: ChatMessage | undefined) =>
  message?.parts.some((part) => "state" in part && part.state === "approval-requested") ?? false;

export const Route = createFileRoute("/c/$chatId")({
  // A chat that was never answered isn't saved yet: open it empty.
  loader: async ({ params }): Promise<{ messages: ChatMessage[] }> => {
    const res = await fetch(`/api/chats/${encodeURIComponent(params.chatId)}`);
    if (res.status === 404) return { messages: [] };
    if (!res.ok) throw new Error(`Couldn't load the conversation (HTTP ${res.status})`);
    return res.json();
  },
  // Never reopen a chat from cached data: useChat only reads its initial
  // messages once, and the next save would drop any newer ones.
  gcTime: 0,
  component: ChatRoute,
});

function ChatRoute() {
  const { chatId } = Route.useParams();
  const { messages } = Route.useLoaderData();
  // useChat doesn't reset when its id changes, so each chat gets a fresh page.
  return <ChatPage key={chatId} id={chatId} initialMessages={messages} />;
}

function ChatPage({ id, initialMessages }: { id: string; initialMessages: ChatMessage[] }) {
  const [model, setModel] = useState(models[0].id);
  // The model rides on the transport, not on each sendMessage call, so the
  // automatic resend after a confirmation uses the same model.
  const modelRef = useRef(model);
  modelRef.current = model;
  const [transport] = useState(
    () =>
      // Same-origin request: the Cloudflare Access session cookie goes along
      // automatically, so no auth header is needed.
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        body: () => ({ model: modelRef.current }),
      })
  );
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat<ChatMessage>({
    // The id rides along as `id` in the request body; the backend saves the chat under it.
    id,
    messages: initialMessages,
    transport,
    // After the user answers a confirmation card, continue the same answer.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const { setTitle, setUsage, refreshChats } = useChatSession();

  const selectedModel = models.find((m) => m.id === model) ?? models[0];

  const send = (text: string) => {
    sendMessage({ text });
  };
  const handleSubmit = (message: { text: string }) => send(message.text);

  // The title only arrives with the first answer; later answers never replace it.
  const title = useMemo(() => {
    for (const message of messages) {
      const t = followupsOf(message)?.title;
      if (t) return t;
    }
    return null;
  }, [messages]);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);

  // The header's cost meter: every answer's usage so far.
  const usage = useMemo(
    () => sumUsage(messages.flatMap((m) => (m.role === "assistant" && m.metadata?.usage ? [m.metadata.usage] : []))),
    [messages]
  );
  useEffect(() => {
    setUsage(usage);
    return () => setUsage(null);
  }, [usage, setUsage]);

  // Each finished answer saved the chat (and maybe titled it): refresh the sidebar.
  const answered = useRef(false);
  useEffect(() => {
    if (status === "streaming") answered.current = true;
    if (status === "ready" && answered.current) {
      answered.current = false;
      refreshChats();
    }
  }, [status, refreshChats]);

  // Chips belong to the latest answer only, and hide while a reply is in flight.
  const last = messages.at(-1);
  const suggestions =
    status === "ready" && last?.role === "assistant" && !isAwaitingApproval(last)
      ? followupsOf(last)?.suggestions
      : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Conversation className="flex-1 min-h-0">
        {/* pr-16 keeps user bubbles clear of the floating download button */}
        <ConversationContent className="pr-16">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="flex-1"
              title="What can I help you with?"
              description="Your team's assistant: search docs, read and file issues, run code, and draft bug reports."
              icon={<MessageSquareIcon className="size-8" />}
            />
          ) : (
            messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <Message from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, i) => {
                      if (part.type === "reasoning") {
                        return (
                          <Reasoning
                            key={i}
                            isStreaming={part.state === "streaming"}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      }
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
                        );
                      }
                      if (part.type === "tool-executeCode") {
                        const input = (part.input ?? {}) as {
                          code?: string;
                          language?: string;
                        };
                        const output = part.state === "output-available"
                          ? (part.output as {
                              stdout?: string;
                              stderr?: string;
                            })
                          : undefined;
                        return (
                          <Sandbox key={i}>
                            <SandboxHeader
                              title={input.language === "python" ? "Python" : "JavaScript"}
                              state={part.state as "input-streaming" | "input-available" | "output-available" | "output-error"}
                            />
                            <SandboxContent>
                              <SandboxTabs
                                code={input.code ?? ""}
                                language={input.language ?? "javascript"}
                                output={output?.stdout}
                                stderr={output?.stderr}
                                isComplete={
                                  part.state === "output-available" ||
                                  part.state === "output-error"
                                }
                              />
                            </SandboxContent>
                          </Sandbox>
                        );
                      }
                      if (part.type === "tool-fileBugReport" && part.state === "output-available") {
                        const { instanceId } = part.output as { instanceId: string };
                        return <BugReportCard key={i} instanceId={instanceId} />;
                      }
                      if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                        const toolPart = part as ToolPart;
                        const elicitation = elicitationFor(message, toolPart.toolCallId);
                        if (elicitation && "approval" in toolPart && toolPart.approval) {
                          const { approval } = toolPart;
                          return (
                            <div key={i}>
                              <Confirmation
                                server={elicitation.server}
                                message={elicitation.message}
                                state={
                                  approval.approved === undefined
                                    ? "pending"
                                    : approval.approved
                                      ? "approved"
                                      : "cancelled"
                                }
                                onApprove={() => addToolApprovalResponse({ id: approval.id, approved: true })}
                                onCancel={() =>
                                  addToolApprovalResponse({
                                    id: approval.id,
                                    approved: false,
                                    reason: "The user cancelled this action.",
                                  })
                                }
                              />
                              {toolPart.state !== "approval-requested" && (
                                <ToolInvocation part={toolPart} />
                              )}
                            </div>
                          );
                        }
                        return <ToolInvocation key={i} part={toolPart} />;
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
                {message === last && suggestions && (
                  <Suggestions className="mt-2" suggestions={suggestions} onSuggestionClick={send} />
                )}
              </MessageScrollerItem>
            ))
          )}
          {error && (
            <p role="alert" className="mx-auto max-w-xl rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {errorText(error)}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
        {messages.length > 0 && (
          <ConversationDownload messages={messages} />
        )}
      </Conversation>

      <PromptInputProvider>
        <PromptInput onSubmit={handleSubmit} className="border-t p-4">
          <PromptInputBody>
            <PromptInputTextarea placeholder="Type a message..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <ModelSelector>
                <ModelSelectorTrigger>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ModelSelectorLogo provider={selectedModel.provider} />
                    <span>{selectedModel.name}</span>
                  </button>
                </ModelSelectorTrigger>
                <ModelSelectorContent>
                  <ModelSelectorGroup heading="Models">
                    <ModelSelectorList value={model} onValueChange={setModel}>
                      {models.map((m) => (
                        <ModelSelectorItem key={m.id} value={m.id}>
                          <ModelSelectorLogo provider={m.provider} />
                          <ModelSelectorName>{m.name}</ModelSelectorName>
                        </ModelSelectorItem>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorGroup>
                </ModelSelectorContent>
              </ModelSelector>
            </PromptInputTools>
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  );
}
