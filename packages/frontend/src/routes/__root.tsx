import { Link, Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-3 flex items-center gap-4">
        <Link to="/" className="text-lg font-semibold">
          Chatbot
        </Link>
        <nav className="flex gap-3 text-sm">
          <Link
            to="/openai-chat"
            className="text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            OpenAI
          </Link>
          <Link
            to="/ollama-chat"
            className="text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground font-medium" }}
          >
            Ollama
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
