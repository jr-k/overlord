import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects, toolRequests } from "../db/schema.js";
import { and, eq, desc } from "drizzle-orm";
import { DEFAULT_ALLOWED_TOOLS } from "../agent/default-tools.js";

const app = new Hono();

// The effective allowlist for a project: its custom list, or the defaults.
function currentAllowed(project: { allowedTools: string | null }): string[] {
  if (project.allowedTools) {
    try {
      const parsed = JSON.parse(project.allowedTools);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [...DEFAULT_ALLOWED_TOOLS];
}

// A tool is covered if it's listed verbatim, or its whole MCP server is allowed
// (e.g. allowing "mcp__claude_ai_Gmail" covers "mcp__claude_ai_Gmail__search").
function isCovered(tool: string, allowed: string[]): boolean {
  if (allowed.includes(tool)) return true;
  const server = tool.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/)?.[1];
  return server ? allowed.includes(server) : false;
}

// GET /api/tool-requests/:projectId — list requests (pending by default)
app.get("/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const status = c.req.query("status") ?? "pending";
  const rows = db
    .select()
    .from(toolRequests)
    .where(and(eq(toolRequests.projectId, projectId), eq(toolRequests.status, status as any)))
    .orderBy(desc(toolRequests.createdAt))
    .all();
  return c.json(rows);
});

// POST /api/tool-requests/:projectId — agent files a request { tool, reason }
app.post("/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const tool = typeof body.tool === "string" ? body.tool.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;
  if (!tool) return c.json({ error: "tool required" }, 400);

  if (isCovered(tool, currentAllowed(project))) {
    return c.json({ status: "already_allowed", tool });
  }

  // Dedupe: reuse an existing pending request for the same tool.
  const existing = db
    .select()
    .from(toolRequests)
    .where(
      and(
        eq(toolRequests.projectId, projectId),
        eq(toolRequests.tool, tool),
        eq(toolRequests.status, "pending")
      )
    )
    .get();
  if (existing) return c.json({ status: "pending", request: existing, deduped: true });

  const created = db
    .insert(toolRequests)
    .values({ projectId, tool, reason })
    .returning()
    .get();
  return c.json({ status: "pending", request: created });
});

// POST /api/tool-requests/:projectId/:reqId/approve
app.post("/:projectId/:reqId/approve", (c) => {
  const reqId = Number(c.req.param("reqId"));
  const request = db.select().from(toolRequests).where(eq(toolRequests.id, reqId)).get();
  if (!request) return c.json({ error: "Not found" }, 404);

  const project = db.select().from(projects).where(eq(projects.id, request.projectId)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const allowed = currentAllowed(project);
  if (!isCovered(request.tool, allowed)) allowed.push(request.tool);

  db.update(projects)
    .set({ allowedTools: JSON.stringify([...new Set(allowed)]), updatedAt: new Date().toISOString() })
    .where(eq(projects.id, project.id))
    .run();

  db.update(toolRequests)
    .set({ status: "approved", resolvedAt: new Date().toISOString() })
    .where(eq(toolRequests.id, reqId))
    .run();

  return c.json({ ok: true, tool: request.tool, allowedTools: allowed });
});

// POST /api/tool-requests/:projectId/:reqId/deny
app.post("/:projectId/:reqId/deny", (c) => {
  const reqId = Number(c.req.param("reqId"));
  const request = db.select().from(toolRequests).where(eq(toolRequests.id, reqId)).get();
  if (!request) return c.json({ error: "Not found" }, 404);

  db.update(toolRequests)
    .set({ status: "denied", resolvedAt: new Date().toISOString() })
    .where(eq(toolRequests.id, reqId))
    .run();

  return c.json({ ok: true });
});

export default app;
