import type { UIMessage } from "ai";

/** Every conversation in local development belongs to this user (no identity there). */
export const LOCAL_OWNER = "local";

/**
 * Who owns the caller's chats: their verified Access identity, or the single
 * local user in development. Deployed without an identity (e.g. a service
 * token), nothing is stored or readable.
 */
export function chatOwner(userId: string | null, local: boolean): string | null {
  return userId ?? (local ? LOCAL_OWNER : null);
}

export type ChatSummary = { id: string; title: string; updatedAt: number };

/**
 * Creates the chat for its owner if it doesn't exist yet, then reports whether
 * the caller owns it. The id comes from the client, so this runs before
 * anything is loaded or saved: a taken id is refused, never overwritten.
 */
export async function claimChat(
  db: D1Database,
  id: string,
  owner: string
): Promise<{ owned: false } | { owned: true; tokenTotal: number }> {
  await db
    .prepare("INSERT OR IGNORE INTO chats (id, user_id, updated_at) VALUES (?, ?, ?)")
    .bind(id, owner, Date.now())
    .run();
  const row = await db
    .prepare("SELECT user_id, token_total FROM chats WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; token_total: number }>();
  return row?.user_id === owner ? { owned: true, tokenTotal: row.token_total } : { owned: false };
}

/** The chat and its messages, or null when it doesn't exist or isn't the owner's. */
export async function loadChat(
  db: D1Database,
  id: string,
  owner: string
): Promise<{ id: string; title: string | null; messages: UIMessage[] } | null> {
  const chat = await db
    .prepare("SELECT id, title FROM chats WHERE id = ? AND user_id = ?")
    .bind(id, owner)
    .first<{ id: string; title: string | null }>();
  if (!chat) return null;
  const { results } = await db
    .prepare("SELECT ui_message FROM messages WHERE chat_id = ? ORDER BY seq")
    .bind(id)
    .all<{ ui_message: string }>();
  return { ...chat, messages: results.map((r) => JSON.parse(r.ui_message) as UIMessage) };
}

/**
 * Stores the conversation as it stands after a response, and adds the tokens
 * the response used. Rewrites every message: a continuation (after a
 * confirmation) changes the last one in place.
 */
export async function saveChat(
  db: D1Database,
  id: string,
  { messages, title, tokens }: { messages: UIMessage[]; title?: string; tokens: number }
): Promise<void> {
  await db.batch([
    ...messages.map((message, seq) =>
      db
        .prepare(
          `INSERT INTO messages (chat_id, seq, ui_message) VALUES (?, ?, ?)
           ON CONFLICT (chat_id, seq) DO UPDATE SET ui_message = excluded.ui_message`
        )
        .bind(id, seq, JSON.stringify(message))
    ),
    db.prepare("DELETE FROM messages WHERE chat_id = ? AND seq >= ?").bind(id, messages.length),
    // The first title wins: later answers never rename the chat.
    db
      .prepare(
        "UPDATE chats SET title = COALESCE(title, ?), token_total = token_total + ?, updated_at = ? WHERE id = ?"
      )
      .bind(title ?? null, tokens, Date.now(), id),
  ]);
}

/** The owner's titled chats, most recent first. */
export async function listChats(db: D1Database, owner: string): Promise<ChatSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, updated_at FROM chats
       WHERE user_id = ? AND title IS NOT NULL
       ORDER BY updated_at DESC LIMIT 100`
    )
    .bind(owner)
    .all<{ id: string; title: string; updated_at: number }>();
  return results.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}
