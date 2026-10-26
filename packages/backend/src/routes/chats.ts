import { Hono } from "hono";
import type { AppEnv } from "../types";
import { chatOwner, listChats, loadChat } from "../chats/store";

const chats = new Hono<AppEnv>();

/** The caller's titled conversations, most recent first, for the history sidebar. */
chats.get("/chats", async (c) => {
  const owner = chatOwner(c.get("userId"), c.env.ENVIRONMENT === "development");
  return c.json(owner ? await listChats(c.env.DB, owner) : []);
});

/** One conversation with its messages. Someone else's reads as not found. */
chats.get("/chats/:id", async (c) => {
  const owner = chatOwner(c.get("userId"), c.env.ENVIRONMENT === "development");
  const chat = owner ? await loadChat(c.env.DB, c.req.param("id"), owner) : null;
  if (!chat) return c.json({ error: "Not found" }, 404);
  return c.json(chat);
});

export default chats;
