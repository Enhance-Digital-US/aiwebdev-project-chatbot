import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="flex-1 grid place-items-center p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Chatbot</h1>
        <p className="text-muted-foreground">The scaffold is running. The chat comes next.</p>
      </div>
    </div>
  );
}
