import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { SquarePenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatHistory } from "@/components/chat-history";
import { ChatSessionProvider, newChatId, useChatSession, type ConversationUsage } from "@/lib/chat-session";

export const Route = createRootRoute({
  component: RootLayout,
});

const tokenFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** "$0.0012", or "unknown" for models without a price (never shown as free). */
function costLabel(usage: ConversationUsage): string {
  const known = `$${usage.cost.toFixed(usage.cost < 0.01 ? 4 : 2)}`;
  if (!usage.costUnknown) return known;
  return usage.cost > 0 ? `${known} + unknown` : "cost unknown";
}

function CostMeter() {
  const { usage } = useChatSession();
  if (!usage) return null;
  return (
    <span
      className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground"
      aria-label="Conversation usage"
      title={`${usage.tokens.toLocaleString()} tokens (${usage.cachedTokens.toLocaleString()} cached input), estimated cost ${costLabel(usage)}`}
    >
      {tokenFormat.format(usage.tokens)} tokens · {costLabel(usage)}
    </span>
  );
}

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
        <CostMeter />
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
