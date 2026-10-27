import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";

/** A new conversation's id; the backend stores the chat under it on the first answer. */
export const newChatId = () => nanoid();

/** Mirrors GET /api/chats (backend routes/chats.ts). */
export type ChatSummary = { id: string; title: string; updatedAt: number };

// The header and sidebar live in the root layout; the open chat page feeds them.
type ChatSession = {
  title: string | null;
  setTitle: (title: string | null) => void;
  chats: ChatSummary[];
  /** Re-reads the sidebar list, e.g. after an answer saved a chat. */
  refreshChats: () => void;
};

const ChatSessionContext = createContext<ChatSession>({
  title: null,
  setTitle: () => {},
  chats: [],
  refreshChats: () => {},
});

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);

  const refreshChats = useCallback(() => {
    fetch("/api/chats")
      .then((res) => (res.ok ? (res.json() as Promise<ChatSummary[]>) : Promise.reject(res.status)))
      .then(setChats)
      .catch(() => {
        // keep the last list; the next answer retries
      });
  }, []);
  useEffect(refreshChats, [refreshChats]);

  return (
    <ChatSessionContext.Provider value={{ title, setTitle, chats, refreshChats }}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export const useChatSession = () => useContext(ChatSessionContext);
