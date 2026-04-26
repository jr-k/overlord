import { Hono } from "hono";
import { db } from "../db/index.js";
import { marketingAssets, marketingDrafts, projects } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync, spawn } from "child_process";

const app = new Hono();

const ASSETS_DIR = join(homedir(), ".overlord", "assets");
mkdirSync(ASSETS_DIR, { recursive: true });

// ─── Assets ──────────────────────────────────────────────────

app.get("/assets/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const assets = db
    .select()
    .from(marketingAssets)
    .where(eq(marketingAssets.projectId, projectId))
    .orderBy(desc(marketingAssets.createdAt))
    .all();
  return c.json(assets);
});

app.post("/assets/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const body = await c.req.parseBody();
  const file = body.file as File;
  const type = (body.type as string) || "other";

  if (!file) return c.json({ error: "file required" }, 400);

  const projectDir = join(ASSETS_DIR, String(projectId));
  mkdirSync(projectDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${timestamp}_${safeName}`;
  const filePath = join(projectDir, fileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filePath, buffer);

  const asset = db
    .insert(marketingAssets)
    .values({ projectId, type, name: file.name, filePath, mimeType: file.type })
    .returning()
    .get();

  return c.json(asset);
});

app.get("/assets/file/:id", (c) => {
  const id = Number(c.req.param("id"));
  const asset = db.select().from(marketingAssets).where(eq(marketingAssets.id, id)).get();
  if (!asset || !existsSync(asset.filePath)) return c.json({ error: "not found" }, 404);

  const data = readFileSync(asset.filePath);
  return new Response(data, {
    headers: { "Content-Type": asset.mimeType || "application/octet-stream" },
  });
});

app.delete("/assets/:id", (c) => {
  const id = Number(c.req.param("id"));
  const asset = db.select().from(marketingAssets).where(eq(marketingAssets.id, id)).get();
  if (asset && existsSync(asset.filePath)) {
    try { unlinkSync(asset.filePath); } catch {}
  }
  db.delete(marketingAssets).where(eq(marketingAssets.id, id)).run();
  return c.json({ ok: true });
});

// ─── Drafts ──────────────────────────────────────────────────

app.get("/drafts/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const drafts = db
    .select()
    .from(marketingDrafts)
    .where(eq(marketingDrafts.projectId, projectId))
    .orderBy(desc(marketingDrafts.updatedAt))
    .all();
  return c.json(drafts);
});

app.post("/drafts", async (c) => {
  const body = await c.req.json();
  const result = db
    .insert(marketingDrafts)
    .values({
      projectId: body.projectId,
      platform: body.platform,
      title: body.title ?? null,
      content: body.content,
      status: body.status ?? "draft",
    })
    .returning()
    .get();
  return c.json(result);
});

app.patch("/drafts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  db.update(marketingDrafts)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(marketingDrafts.id, id))
    .run();
  const updated = db.select().from(marketingDrafts).where(eq(marketingDrafts.id, id)).get();
  return c.json(updated);
});

app.delete("/drafts/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.delete(marketingDrafts).where(eq(marketingDrafts.id, id)).run();
  return c.json({ ok: true });
});

// ─── Generation (via Claude) ─────────────────────────────────

const PLATFORM_PROMPTS: Record<string, string> = {
  twitter: "Write a Twitter/X post (max 280 chars) that announces or shares what was recently done on this project. Punchy, direct, no hashtag spam. One emoji max.",
  linkedin: "Write a LinkedIn post that tells the story of what was recently shipped on this project. Use short lines, a hook, build-in-public tone. Aim for 150-300 words. No corporate jargon.",
  blog: "Write a blog post / devlog entry for what was recently shipped. Markdown format, title + sections + code snippets where useful. Aim for 400-800 words.",
  release_notes: "Generate release notes in markdown from the git commits. Group by type (feat, fix, refactor, docs). Keep it concise and user-facing.",
  other: "Write content about what was recently shipped on this project.",
};

app.post("/generate/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const body = await c.req.json();
  const platform = body.platform as string;
  const extraInstructions = body.instructions as string | undefined;

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "project not found" }, 404);

  // Gather context: recent git commits + project info
  let commits = "";
  try {
    // Get commits since last tag, or last 20 commits
    let range = "HEAD~20..HEAD";
    try {
      const lastTag = execSync("git describe --tags --abbrev=0", {
        cwd: project.path, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (lastTag) range = `${lastTag}..HEAD`;
    } catch {}
    commits = execSync(`git log ${range} --pretty=format:"%h %s"`, {
      cwd: project.path, encoding: "utf-8", timeout: 5000,
    }).trim();
  } catch (err) {
    commits = "(no git history available)";
  }

  const contextParts: string[] = [];
  contextParts.push(`Project: ${project.name}`);
  if (project.tagline) contextParts.push(`Tagline: ${project.tagline}`);
  if (project.shortDescription) contextParts.push(`Description: ${project.shortDescription}`);
  if (project.summary) contextParts.push(`Summary: ${project.summary}`);
  contextParts.push(`\nRecent commits:\n${commits || "(none)"}`);

  const context = contextParts.join("\n");
  const platformPrompt = PLATFORM_PROMPTS[platform] ?? PLATFORM_PROMPTS.other;

  const prompt = `You are helping with marketing content for a solo developer's project.

${context}

TASK: ${platformPrompt}
${extraInstructions ? `\nAdditional instructions: ${extraInstructions}` : ""}

Output ONLY the final content, no preamble, no explanation.`;

  console.log(`[marketing:${projectId}] generating ${platform}`);

  const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

  const result = await new Promise<{ content: string; error?: string }>((resolve) => {
    const proc = spawn(CLAUDE_PATH, ["--print", "--", prompt], {
      cwd: project.path,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    proc.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr!.on("data", () => {});

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ content: output.trim(), error: "Timeout" });
    }, 2 * 60 * 1000);

    proc.on("close", () => {
      clearTimeout(timeout);
      resolve({ content: output.trim() });
    });
  });

  if (result.error && !result.content) {
    return c.json({ error: result.error }, 500);
  }

  // Save as a draft
  const draft = db
    .insert(marketingDrafts)
    .values({
      projectId,
      platform,
      content: result.content,
      status: "draft",
    })
    .returning()
    .get();

  return c.json(draft);
});

export default app;
