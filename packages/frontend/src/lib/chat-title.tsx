import { createContext, useContext, useState, type ReactNode } from "react";

// The header lives in the root layout; the title comes from the chat page.
type ChatTitle = { title: string | null; setTitle: (title: string | null) => void };

const ChatTitleContext = createContext<ChatTitle>({ title: null, setTitle: () => {} });

export function ChatTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <ChatTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </ChatTitleContext.Provider>
  );
}

export const useChatTitle = () => useContext(ChatTitleContext);
