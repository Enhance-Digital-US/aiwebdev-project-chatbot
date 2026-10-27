import { createFileRoute, redirect } from "@tanstack/react-router";
import { newChatId } from "@/lib/chat-session";

// Every conversation has its own URL, so a reload reopens it.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/c/$chatId", params: { chatId: newChatId() }, replace: true });
  },
});
