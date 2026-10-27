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
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { MessageSquareIcon } from "lucide-react";

// Same origin: Vite proxies /api to the backend in dev, so no CORS setup or

// auth header is needed.
const transport = new DefaultChatTransport({ api: "/api/chat" });

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  const { messages, sendMessage, status } = useChat({ transport });

  const handleSubmit = (message: { text: string }) => {
    sendMessage({ text: message.text });
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
              description="Ask me anything — I can explain concepts and help you think through code."
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
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
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
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  );
}
