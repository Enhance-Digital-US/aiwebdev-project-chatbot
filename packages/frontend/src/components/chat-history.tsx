import { Link } from "@tanstack/react-router";
import { useChatSession, type ChatSummary } from "@/lib/chat-session";
import { cn } from "@/lib/utils";

/** "Today", "Yesterday", else the date: chats are grouped by the day they were last used. */
export function dayLabel(timestamp: number, now = new Date()): string {
  const day = new Date(timestamp);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: day.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function groupByDay(chats: ChatSummary[]): [string, ChatSummary[]][] {
  const groups = new Map<string, ChatSummary[]>();
  for (const chat of chats) {
    const label = dayLabel(chat.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), chat]);
  }
  return [...groups];
}

/** The user's titled conversations, most recent first (GET /api/chats). */
export function ChatHistory({ className }: { className?: string }) {
  const { chats } = useChatSession();
  return (
    <nav aria-label="Conversations" className={cn("flex flex-col gap-4 overflow-y-auto p-2 text-sm", className)}>
      {chats.length === 0 && <p className="px-2 text-muted-foreground">No conversations yet.</p>}
      {groupByDay(chats).map(([label, group]) => (
        <section key={label}>
          <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{label}</h2>
          <ul>
            {group.map((chat) => (
              <li key={chat.id}>
                <Link
                  to="/c/$chatId"
                  params={{ chatId: chat.id }}
                  className="block truncate rounded-md px-2 py-1.5 hover:bg-accent"
                  activeProps={{ className: "bg-accent font-medium" }}
                  title={chat.title}
                >
                  {chat.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
