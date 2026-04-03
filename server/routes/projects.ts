import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects, sessions } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

const app = new Hono();

// GET /api/projects - list all projects
app.get("/", (c) => {
  const allProjects = db
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt))
    .all();
  return c.json(allProjects);
});

// GET /api/projects/:id - get a project with its latest session
app.get("/:id", (c) => {
  const id = Number(c.req.param("id"));
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const latestSession = db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, id))
    .orderBy(desc(sessions.startedAt))
    .limit(1)
    .get();

  return c.json({ ...project, latestSession: latestSession ?? null });
});

// PATCH /api/projects/:id - update project status
app.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  db.update(projects)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .run();
  const updated = db.select().from(projects).where(eq(projects.id, id)).get();
  return c.json(updated);
});

// POST /api/projects/scan - scan root dir for git projects
app.post("/scan", (c) => {
  const rootDir = (c.get("rootDir" as never) as string) || process.cwd();
  const found: string[] = [];

  try {
    const entries = readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = join(rootDir, entry.name);
        if (existsSync(join(projectPath, ".git"))) {
          found.push(entry.name);
        }
      }
    }
  } catch {
    return c.json({ error: "Cannot read root directory" }, 500);
  }

  // Upsert found projects
  const upserted = [];
  for (const name of found) {
    const path = join(rootDir, name);
    const existing = db
      .select()
      .from(projects)
      .where(eq(projects.path, path))
      .get();
    if (!existing) {
      db.insert(projects).values({ name, path }).run();
    }
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.path, path))
      .get();
    upserted.push(project);
  }

  return c.json(upserted);
});

export default app;
