import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const app = new Hono();

interface Skill {
  name: string;
  description: string | null;
  scope: "project" | "global";
  source: string; // path
  type: "skill" | "command"; // skills/ dir or commands/*.md
}

// Parse frontmatter from markdown
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  const lines = match[1].split("\n");
  let currentKey = "";
  let multilineValue = "";
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith("  ") || line === "") {
        multilineValue += line.slice(2) + "\n";
        continue;
      } else {
        result[currentKey] = multilineValue.trim();
        inMultiline = false;
      }
    }
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/i);
    if (kv) {
      if (kv[2] === "|" || kv[2] === ">") {
        currentKey = kv[1];
        multilineValue = "";
        inMultiline = true;
      } else {
        result[kv[1]] = kv[2].trim();
      }
    }
  }
  if (inMultiline && currentKey) {
    result[currentKey] = multilineValue.trim();
  }
  return result;
}

function listSkillsDir(baseDir: string, scope: "project" | "global"): Skill[] {
  const results: Skill[] = [];
  const skillsDir = join(baseDir, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, "utf-8");
          const fm = parseFrontmatter(content);
          results.push({
            name: fm.name || entry.name,
            description: fm.description || null,
            scope,
            source: skillFile,
            type: "skill",
          });
        } catch {}
      }
    }
  }

  const commandsDir = join(baseDir, "commands");
  if (existsSync(commandsDir) && statSync(commandsDir).isDirectory()) {
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const cmdFile = join(commandsDir, entry.name);
        try {
          const content = readFileSync(cmdFile, "utf-8");
          const fm = parseFrontmatter(content);
          const name = entry.name.replace(/\.md$/, "");
          results.push({
            name: fm.name || name,
            description: fm.description || null,
            scope,
            source: cmdFile,
            type: "command",
          });
        } catch {}
      }
    }
  }

  return results;
}

app.get("/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const globalSkills = listSkillsDir(join(homedir(), ".claude"), "global");
  const projectSkills = listSkillsDir(join(project.path, ".claude"), "project");

  return c.json({
    project: projectSkills,
    global: globalSkills,
  });
});

app.get("/:projectId/content", (c) => {
  const source = c.req.query("source");
  if (!source) return c.json({ error: "source required" }, 400);

  // Safety: only allow files under .claude paths
  if (!source.includes("/.claude/")) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const content = readFileSync(source, "utf-8");
    return c.json({ content });
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

export default app;
