import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Same origin: Vite proxies /api to the backend in dev.
const transport = new DefaultChatTransport({ api: "/api/chat" });

export const Route = createFileRoute("/")({
  component: ChatPage,
});

function ChatPage() {
  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id}>
            <div className="text-xs font-medium text-muted-foreground">
              {message.role === "user" ? "You" : "Assistant"}
            </div>
            {/* Only text for now: the reply arrives as plain text parts. */}
            <div className="whitespace-pre-wrap">
              {message.parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.text}</span> : null))}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-4">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." />
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
