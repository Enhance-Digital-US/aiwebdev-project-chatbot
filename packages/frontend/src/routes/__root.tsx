import { Outlet, createRootRoute } from "@tanstack/react-router";
import { ChatTitleProvider, useChatTitle } from "@/lib/chat-title";

export const Route = createRootRoute({
  component: RootLayout,
});

function Header() {
  const { title } = useChatTitle();
  return (
    <header className="flex items-baseline gap-2 border-b px-4 py-3 min-w-0">
      <span className="text-lg font-semibold shrink-0">Team Assistant</span>
      {title && (
        <span className="truncate text-sm text-muted-foreground" title={title}>
          · {title}
        </span>
      )}
    </header>
  );
}

function RootLayout() {
  return (
    <ChatTitleProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <Outlet />
      </div>
    </ChatTitleProvider>
  );
}
