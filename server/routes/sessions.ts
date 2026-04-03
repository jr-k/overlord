import { Hono } from "hono";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const app = new Hono();

// GET /api/sessions/:projectId - list sessions for a project
app.get("/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const result = db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(desc(sessions.startedAt))
    .all();
  return c.json(result);
});

// POST /api/sessions - create a new session
app.post("/", async (c) => {
  const body = await c.req.json();
  const result = db
    .insert(sessions)
    .values({
      projectId: body.projectId,
      summary: body.summary ?? null,
      endedAt: body.endedAt ?? null,
    })
    .returning()
    .get();
  return c.json(result);
});

// PATCH /api/sessions/:id - update a session (e.g., add summary)
app.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  db.update(sessions).set(body).where(eq(sessions.id, id)).run();
  const updated = db.select().from(sessions).where(eq(sessions.id, id)).get();
  return c.json(updated);
});

export default app;
