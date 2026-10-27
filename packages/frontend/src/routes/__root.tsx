import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { SquarePenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatHistory } from "@/components/chat-history";
import { ChatSessionProvider, newChatId, useChatSession } from "@/lib/chat-session";

export const Route = createRootRoute({
  component: RootLayout,
});

function Header() {
  const { title } = useChatSession();
  const navigate = useNavigate();
  return (
    <header className="flex items-center gap-2 border-b px-4 py-3 min-w-0">
      <span className="text-lg font-semibold shrink-0">Team Assistant</span>
      {title && (
        <span className="truncate text-sm text-muted-foreground" title={title}>
          · {title}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/c/$chatId", params: { chatId: newChatId() } })}
        >
          <SquarePenIcon />
          New chat
        </Button>
      </div>
    </header>
  );
}

function RootLayout() {
  return (
    <ChatSessionProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 min-h-0">
          <ChatHistory className="hidden w-64 shrink-0 border-r md:flex" />
          <main className="flex flex-1 flex-col min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </ChatSessionProvider>
  );
}
