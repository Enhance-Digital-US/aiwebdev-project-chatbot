import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AuthButtons } from "@/auth";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <span className="text-lg font-semibold">Chatbot</span>
        <AuthButtons />
      </header>
      <Outlet />
    </div>
  );
}
