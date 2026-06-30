import { Hono } from "hono";
import { db } from "../db/index.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const app = new Hono();

type CommandType = "skill" | "command" | "agent" | "plugin" | "builtin";
type CommandScope = "project" | "global" | "plugin" | "builtin";

interface SlashCommand {
  name: string;
  description: string | null;
  type: CommandType;
  scope: CommandScope;
}

interface CommandMeta {
  description: string | null;
  type: CommandType;
  scope: CommandScope;
}

// --- frontmatter parsing (mirrors skills.ts) ---
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

// Scan a .claude base dir for skills + commands, indexed by their slash name,
// so we can attach descriptions to the authoritative list from the CLI.
function scanMeta(baseDir: string, scope: CommandScope, out: Map<string, CommandMeta>) {
  const skillsDir = join(baseDir, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillFile = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        const fm = parseFrontmatter(readFileSync(skillFile, "utf-8"));
        const name = fm.name || entry.name;
        if (!out.has(name)) out.set(name, { description: fm.description || null, type: "skill", scope });
      } catch {}
    }
  }

  const commandsDir = join(baseDir, "commands");
  if (existsSync(commandsDir) && statSync(commandsDir).isDirectory()) {
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      try {
        const fm = parseFrontmatter(readFileSync(join(commandsDir, entry.name), "utf-8"));
        const name = entry.name.replace(/\.md$/, "");
        if (!out.has(name)) out.set(name, { description: fm.description || null, type: "command", scope });
      } catch {}
    }
  }
}

// --- claude version (memoized, so typing in the input never spawns claude) ---
let versionCache: { value: string; at: number } | null = null;
function getClaudeVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 5 * 60 * 1000) {
    return Promise.resolve(versionCache.value);
  }
  return new Promise((resolve) => {
    let out = "";
    const proc = spawn("claude", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(versionCache?.value ?? ""));
    proc.on("close", () => {
      // "2.1.191 (Claude Code)" -> "2.1.191"
      const v = (out.trim().match(/^[\d.]+/)?.[0]) ?? out.trim();
      versionCache = { value: v, at: Date.now() };
      resolve(v);
    });
  });
}

// Capture the first system/init event from a stream-json run, then kill the
// process immediately — init is emitted before any model call, so this costs
// no model tokens. Returns the authoritative slash command names + version.
function probeInit(cwd: string): Promise<{ version: string; names: string[] }> {
  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    const finish = (result: { version: string; names: string[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill("SIGTERM"); } catch {}
      resolve(result);
    };

    const proc = spawn(
      "claude",
      ["--print", "--output-format", "stream-json", "--verbose", "--", "hi"],
      { cwd, stdio: ["ignore", "pipe", "ignore"] }
    );
    const timer = setTimeout(() => finish({ version: "", names: [] }), 30000);

    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "system" && ev.subtype === "init") {
            finish({
              version: ev.claude_code_version || "",
              names: Array.isArray(ev.slash_commands) ? ev.slash_commands : [],
            });
            return;
          }
        } catch {}
      }
    });
    proc.on("error", () => finish({ version: "", names: [] }));
    proc.on("close", () => finish({ version: "", names: [] }));
  });
}

// Cache the resolved command list per project path, keyed by claude version.
const commandsCache = new Map<string, { version: string; commands: SlashCommand[] }>();

function buildCommands(names: string[], metaMap: Map<string, CommandMeta>): SlashCommand[] {
  return names
    .map((name): SlashCommand => {
      const meta = metaMap.get(name);
      if (meta) return { name, ...meta };
      // Plugin commands are namespaced "plugin:command"; everything else is built-in.
      if (name.includes(":")) return { name, description: null, type: "plugin", scope: "plugin" };
      return { name, description: null, type: "builtin", scope: "builtin" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

app.get("/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  const version = await getClaudeVersion();
  const cached = commandsCache.get(project.path);
  const refresh = c.req.query("refresh") === "1";

  // Same claude version + warm cache -> serve cached (no spawn).
  if (cached && cached.version === version && !refresh) {
    return c.json({ version, commands: cached.commands, cached: true });
  }

  // Version changed (or cold/forced) -> re-discover from the CLI itself.
  const probe = await probeInit(project.path);
  const effectiveVersion = probe.version || version;

  const metaMap = new Map<string, CommandMeta>();
  scanMeta(join(project.path, ".claude"), "project", metaMap);
  scanMeta(join(homedir(), ".claude"), "global", metaMap);

  // If the probe failed (claude missing/offline), degrade to the filesystem scan.
  const names = probe.names.length > 0 ? probe.names : [...metaMap.keys()];
  const commands = buildCommands(names, metaMap);

  commandsCache.set(project.path, { version: effectiveVersion, commands });
  return c.json({ version: effectiveVersion, commands, cached: false });
});

export default app;
