import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";

/** A new conversation's id; the backend stores the chat under it on the first answer. */
export const newChatId = () => nanoid();

/** Mirrors the backend's MessageUsage (packages/backend/src/usage.ts). */
export type MessageUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** USD; null when the model has no price. */
  cost: number | null;
};

/** The open conversation's running totals, for the header's cost meter. */
export type ConversationUsage = {
  tokens: number;
  cachedTokens: number;
  /** Sum of the known costs. */
  cost: number;
  /** Some answers came from a model without a price. */
  costUnknown: boolean;
};

export function sumUsage(usages: MessageUsage[]): ConversationUsage | null {
  if (usages.length === 0) return null;
  return usages.reduce<ConversationUsage>(
    (sum, u) => ({
      tokens: sum.tokens + u.inputTokens + u.outputTokens,
      cachedTokens: sum.cachedTokens + u.cachedInputTokens,
      cost: sum.cost + (u.cost ?? 0),
      costUnknown: sum.costUnknown || u.cost === null,
    }),
    { tokens: 0, cachedTokens: 0, cost: 0, costUnknown: false }
  );
}

/** Mirrors GET /api/chats (backend routes/chats.ts). */
export type ChatSummary = { id: string; title: string; updatedAt: number };

// The header and sidebar live in the root layout; the open chat page feeds them.
type ChatSession = {
  title: string | null;
  setTitle: (title: string | null) => void;
  usage: ConversationUsage | null;
  setUsage: (usage: ConversationUsage | null) => void;
  chats: ChatSummary[];
  /** Re-reads the sidebar list, e.g. after an answer saved a chat. */
  refreshChats: () => void;
};

const ChatSessionContext = createContext<ChatSession>({
  title: null,
  setTitle: () => {},
  usage: null,
  setUsage: () => {},
  chats: [],
  refreshChats: () => {},
});

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [usage, setUsage] = useState<ConversationUsage | null>(null);
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
    <ChatSessionContext.Provider value={{ title, setTitle, usage, setUsage, chats, refreshChats }}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export const useChatSession = () => useContext(ChatSessionContext);
