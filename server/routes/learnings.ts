import { Hono } from "hono";
import { db } from "../db/index.js";
import { learnings, projects } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const app = new Hono();

// GET /api/learnings/:projectId: list all learnings for a project
app.get("/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const result = db
    .select()
    .from(learnings)
    .where(eq(learnings.projectId, projectId))
    .orderBy(desc(learnings.createdAt))
    .all();
  return c.json(result);
});

// GET /api/learnings/:projectId/unreviewed-count
app.get("/:projectId/unreviewed-count", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const all = db
    .select()
    .from(learnings)
    .where(eq(learnings.projectId, projectId))
    .all();
  const count = all.filter((l) => !l.reviewed).length;
  return c.json({ count });
});

// PATCH /api/learnings/:id: mark as reviewed / edit
app.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  db.update(learnings).set(body).where(eq(learnings.id, id)).run();
  const updated = db.select().from(learnings).where(eq(learnings.id, id)).get();
  return c.json(updated);
});

// DELETE /api/learnings/:id
app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.delete(learnings).where(eq(learnings.id, id)).run();
  return c.json({ ok: true });
});

// POST /api/learnings/:projectId/export: merge all learnings into .claude/skills/project-learnings.md
app.post("/:projectId/export", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const all = db
    .select()
    .from(learnings)
    .where(eq(learnings.projectId, projectId))
    .orderBy(desc(learnings.createdAt))
    .all();

  if (all.length === 0) return c.json({ error: "No learnings to export" }, 400);

  // Build the skill content
  const sections: string[] = [];
  sections.push(`---
name: project-learnings
description: Lessons learned from previous sessions on this project. Read these before starting non-trivial work to avoid past dead ends and use established patterns.
---

# Project Learnings

Compiled from ${all.length} session retrospective${all.length > 1 ? "s" : ""}.

`);

  // Aggregate recommendations (most important)
  const allRecommendations = all
    .map((l) => l.recommendations)
    .filter((r): r is string => Boolean(r && r.trim()));
  if (allRecommendations.length > 0) {
    sections.push(`## Recommendations\n\n${allRecommendations.join("\n\n---\n\n")}\n`);
  }

  const allMissingContext = all
    .map((l) => l.missingContext)
    .filter((r): r is string => Boolean(r && r.trim()));
  if (allMissingContext.length > 0) {
    sections.push(`## Missing Context (historical)\n\n${allMissingContext.join("\n\n---\n\n")}\n`);
  }

  const allDeadEnds = all
    .map((l) => l.deadEnds)
    .filter((r): r is string => Boolean(r && r.trim()));
  if (allDeadEnds.length > 0) {
    sections.push(`## Dead Ends to Avoid\n\n${allDeadEnds.join("\n\n---\n\n")}\n`);
  }

  const content = sections.join("\n");
  const skillDir = join(project.path, ".claude", "skills", "project-learnings");
  const skillFile = join(skillDir, "SKILL.md");

  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillFile, content, "utf-8");
    // Mark all as exported
    for (const l of all) {
      db.update(learnings).set({ exported: true }).where(eq(learnings.id, l.id)).run();
    }
    return c.json({ ok: true, path: skillFile, count: all.length });
  } catch (err) {
    return c.json({ error: `Export failed: ${err}` }, 500);
  }
});

export default app;
