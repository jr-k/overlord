import { Hono } from "hono";
import { mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join, basename } from "path";
import { randomUUID } from "crypto";

const UPLOAD_ROOT = join(homedir(), ".overlord", "uploads");

const app = new Hono();

function projectDir(projectId: string | number): string {
  const dir = join(UPLOAD_ROOT, String(projectId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Strip path separators so users can't escape the upload dir
function safeName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

// POST /api/uploads: multipart/form-data with `file` and `projectId`
app.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  const projectId = body["projectId"];

  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const id = randomUUID();
  const filename = safeName(file.name || "file");
  const dir = projectDir(String(projectId));
  const path = join(dir, `${id}-${filename}`);

  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buf);

  console.log(`[upload] ${filename} (${buf.length}b) → ${path}`);

  return c.json({
    id,
    path,
    filename: file.name,
    size: buf.length,
    mimeType: file.type || "application/octet-stream",
  });
});

// DELETE /api/uploads/:id?projectId=N: removes a previously uploaded file
app.delete("/:id", (c) => {
  const id = c.req.param("id");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const dir = projectDir(String(projectId));
  if (!existsSync(dir)) return c.json({ ok: true });

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(`${id}-`)) {
      try {
        const p = join(dir, entry);
        if (statSync(p).isFile()) unlinkSync(p);
        console.log(`[upload] removed ${entry}`);
      } catch {}
    }
  }
  return c.json({ ok: true });
});

export default app;
