import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects, sessions } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { detectWorkspaces } from "../workspaces.js";

function getGitRemoteUrl(projectPath: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();

    // Convert SSH to HTTPS: git@github.com:user/repo.git -> https://github.com/user/repo
    if (url.startsWith("git@")) {
      return url
        .replace(/^git@([^:]+):/, "https://$1/")
        .replace(/\.git$/, "");
    }
    // Clean HTTPS urls
    return url.replace(/\.git$/, "");
  } catch {
    return null;
  }
}

const app = new Hono();

// GET /api/projects - list all projects (non-hidden, favorites first)
app.get("/", (c) => {
  const showHidden = c.req.query("hidden") === "true";
  const allProjects = db
    .select()
    .from(projects)
    .orderBy(desc(projects.favorite), desc(projects.updatedAt))
    .all()
    .filter((p) => showHidden || !p.hidden);
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

  const remoteUrl = getGitRemoteUrl(project.path);
  return c.json({ ...project, latestSession: latestSession ?? null, remoteUrl });
});

// GET /api/projects/:id/workspaces - detect monorepo workspaces
app.get("/:id/workspaces", (c) => {
  const id = Number(c.req.param("id"));
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const info = detectWorkspaces(project.path);
  return c.json(info);
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
