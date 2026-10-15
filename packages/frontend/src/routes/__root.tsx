import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-3">
        <span className="text-lg font-semibold">Chatbot</span>
      </header>
      <Outlet />
    </div>
  );
}
