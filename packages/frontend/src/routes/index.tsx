import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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
import { useEffect, useState } from "react";
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

// Same-origin request: the Cloudflare Access session cookie goes along
// automatically, so no auth header is needed.
const transport = new DefaultChatTransport({ api: "/api/chat" });

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  const [model, setModel] = useState(models[0].id);
  const { messages, sendMessage, status } = useChat({ transport });

  const selectedModel = models.find((m) => m.id === model) ?? models[0];

  const handleSubmit = (message: { text: string }) => {
    sendMessage({ text: message.text }, { body: { model } });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Conversation className="flex-1 min-h-0">
        {/* pr-16 keeps user bubbles clear of the floating download button */}
        <ConversationContent className="pr-16">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="flex-1"
              title="What can I help you with?"
              description="Ask me anything — I can search docs, explain concepts, and help you architect solutions."
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
                      if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                        return (
                          <ToolInvocation key={i} part={part as ToolPart} />
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))
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
