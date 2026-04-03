import { Hono } from "hono";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const app = new Hono();

// GET /api/conversations/:projectId - list conversations for a project
app.get("/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const result = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .all();
  return c.json(result);
});

// GET /api/conversations/:id/messages - get messages for a conversation
app.get("/:id/messages", (c) => {
  const id = Number(c.req.param("id"));
  const result = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .all();
  return c.json(result);
});

// GET /api/conversations/latest/:projectId - get latest conversation with messages
app.get("/latest/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1)
    .get();

  if (!conv) return c.json({ conversation: null, messages: [] });

  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .all();

  return c.json({ conversation: conv, messages: msgs });
});

export default app;
