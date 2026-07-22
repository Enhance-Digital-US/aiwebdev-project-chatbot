import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-bold">Chat Examples</h1>
        <p className="text-muted-foreground">
          Choose a chat example to get started.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            to="/openai-chat"
            className="block rounded-lg border p-4 text-left hover:bg-accent transition-colors"
          >
            <div className="font-medium">OpenAI Chat</div>
            <div className="text-sm text-muted-foreground">
              GPT-4o-mini via OpenAI API
            </div>
          </Link>
          <Link
            to="/ollama-chat"
            className="block rounded-lg border p-4 text-left hover:bg-accent transition-colors"
          >
            <div className="font-medium">Ollama Chat</div>
            <div className="text-sm text-muted-foreground">
              Gemma 4 12B with reasoning traces (local)
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
