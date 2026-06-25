import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import { spawn, execSync } from "child_process";
import { resolve } from "path";
import { pathToFileURL } from "url";

import { initDb, db } from "./db/index.js";
import { conversations, projects } from "./db/schema.js";
import { eq, sql } from "drizzle-orm";

import projectRoutes from "./routes/projects.js";
import sessionRoutes from "./routes/sessions.js";
import conversationRoutes from "./routes/conversations.js";
import todoRoutes from "./routes/todos.js";
import marketingRoutes from "./routes/marketing.js";
import skillsRoutes from "./routes/skills.js";
import learningsRoutes from "./routes/learnings.js";
import codegraphRoutes from "./routes/codegraph.js";
import uploadsRoutes from "./routes/uploads.js";
import settingsRoutes from "./routes/settings.js";
import { getWorkspaceRoot } from "./settings.js";

import { setWebSocketServer } from "./ws.js";
import { attachWsHandlers } from "./agent/ws-handler.js";
import { agentSessions, sessionKey, saveEventsNow } from "./agent/sessions.js";
import { getCommitsSince, rollbackToSnapshot } from "./agent/git-snapshot.js";
import type { Channel } from "./agent/types.js";

const PORT = Number(process.env.PORT) || 4747;
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const STATIC_ROOT = process.env.OVERLORD_STATIC_ROOT || resolve(process.cwd(), "dist/client");

initDb();

const app = new Hono();
app.use("/api/*", cors());
app.use("/api/*", async (c, next) => {
  c.set("rootDir" as never, getWorkspaceRoot() as never);
  await next();
});

app.route("/api/projects", projectRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/todos", todoRoutes);
app.route("/api/marketing", marketingRoutes);
app.route("/api/skills", skillsRoutes);
app.route("/api/learnings", learningsRoutes);
app.route("/api/codegraph", codegraphRoutes);
app.route("/api/uploads", uploadsRoutes);
app.route("/api/settings", settingsRoutes);

type TerminalConfig =
  | { id: string; name: string; platform: "darwin"; app: string }
  | { id: string; name: string; platform: "linux"; cmd: string; args: (dir: string) => string[] }
  | { id: string; name: string; platform: "win32"; cmd: string };

const TERMINALS: TerminalConfig[] = [
  { id: "terminal", name: "Terminal", platform: "darwin", app: "Terminal" },
  { id: "iterm2", name: "iTerm2", platform: "darwin", app: "iTerm" },
  { id: "warp", name: "Warp", platform: "darwin", app: "Warp" },
  { id: "gnome-terminal", name: "GNOME Terminal", platform: "linux", cmd: "gnome-terminal", args: (dir: string) => ["--working-directory", dir] },
  { id: "konsole", name: "Konsole", platform: "linux", cmd: "konsole", args: (dir: string) => ["--workdir", dir] },
  { id: "xfce4-terminal", name: "Xfce Terminal", platform: "linux", cmd: "xfce4-terminal", args: (dir: string) => ["--working-directory", dir] },
  { id: "xterm", name: "xterm", platform: "linux", cmd: "xterm", args: (dir: string) => ["-e", `cd ${JSON.stringify(dir)} && exec $SHELL`] },
  { id: "cmd", name: "Command Prompt", platform: "win32", cmd: "cmd" },
];

function hasDarwinApp(appName: string) {
  try {
    execSync(`osascript -e 'id of app "${appName}"'`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getAvailableTerminals() {
  const platform = process.platform;
  return TERMINALS.filter((terminal) => {
    if (terminal.platform !== platform) return false;
    if ("app" in terminal) return hasDarwinApp(terminal.app);
    if (!("cmd" in terminal) || terminal.cmd === "cmd") return true;
    try {
      execSync(`which ${terminal.cmd}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
}

app.get("/api/terminals", (c) => {
  return c.json(getAvailableTerminals().map(({ id, name }) => ({ id, name })));
});

app.post("/api/terminal/open", async (c) => {
  const body = await c.req.json();
  const dir = body.path;
  if (!dir) return c.json({ error: "Path required" }, 400);

  const available = getAvailableTerminals();
  const terminalConfig = available.find((terminal) => terminal.id === body.terminal) ?? available[0];
  if (!terminalConfig) return c.json({ error: "No terminal found" }, 404);

  if (terminalConfig.platform === "darwin") {
    spawn("open", ["-a", terminalConfig.app, dir], { detached: true, stdio: "ignore" });
  } else if (terminalConfig.platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/K", `cd /d ${dir}`], { detached: true, stdio: "ignore" });
  } else {
    spawn(terminalConfig.cmd, terminalConfig.args(dir), { detached: true, stdio: "ignore" });
  }

  return c.json({ ok: true });
});

const EDITORS = [
  { id: "cursor", name: "Cursor", cmd: "cursor", test: "cursor" },
  { id: "vscode", name: "VS Code", cmd: "code", test: "code" },
  { id: "zed", name: "Zed", cmd: "zed", test: "zed" },
  { id: "webstorm", name: "WebStorm", cmd: "webstorm", test: "webstorm" },
  { id: "idea", name: "IntelliJ IDEA", cmd: "idea", test: "idea" },
  { id: "sublime", name: "Sublime Text", cmd: "subl", test: "subl" },
  { id: "vim", name: "Vim", cmd: "vim", test: "vim" },
  { id: "nano", name: "Nano", cmd: "nano", test: "nano" },
];

app.get("/api/editors", (c) => {
  const available = EDITORS.filter((e) => {
    try {
      execSync(`which ${e.test}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  return c.json(available);
});

app.post("/api/editor/open", async (c) => {
  const body = await c.req.json();
  const { filePath, editor } = body;
  if (!filePath || !editor) return c.json({ error: "filePath and editor required" }, 400);

  const editorConfig = EDITORS.find((e) => e.id === editor);
  if (!editorConfig) return c.json({ error: "Unknown editor" }, 404);

  spawn(editorConfig.cmd, [filePath], { detached: true, stdio: "ignore" });
  return c.json({ ok: true });
});

app.get("/api/rtk/gain/:projectId", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Not found" }, 404);

  try {
    const output = execSync("rtk gain --project --format json", {
      cwd: project.path,
      encoding: "utf-8",
      timeout: 5000,
    });
    return c.json(JSON.parse(output));
  } catch {
    return c.json({ summary: null });
  }
});

app.post("/api/agent/ask", async (c) => {
  const body = await c.req.json();
  const { projectId, question } = body;
  if (!projectId || !question) return c.json({ error: "projectId and question required" }, 400);

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  console.log(`[ask:${project.name}] "${question.slice(0, 80)}..."`);

  const result = await new Promise<{ ok: boolean; answer?: string; error?: string; code?: number | null }>((resolveP) => {
    const proc = spawn(CLAUDE_PATH, ["--print", "--", question], {
      cwd: project.path,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    proc.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
    proc.stderr!.on("data", () => {});

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolveP({ ok: false, error: "Timeout (3min)", answer: output.trim() });
    }, 3 * 60 * 1000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[ask:${project.name}] done code=${code} (${output.length} chars)`);
      resolveP({ ok: true, answer: output.trim(), code });
    });
  });

  return c.json({ ...result, project: project.name });
});

app.post("/api/agent/rollback", async (c) => {
  const body = await c.req.json();
  const { projectId, snapshotSha, messageIndex, channel = "chat" } = body;

  if (!projectId || !snapshotSha) return c.json({ error: "projectId and snapshotSha required" }, 400);

  const session = agentSessions.get(sessionKey(projectId, channel));
  if (!session) return c.json({ error: "No session found" }, 404);

  const commitsSince = getCommitsSince(session.projectPath, snapshotSha);
  if (commitsSince > 0) {
    return c.json({
      error: `${commitsSince} commit(s) ont ete faits depuis ce point. Le rollback ecraserait ces changements.`,
      commitsSince,
      needsConfirm: true,
    });
  }

  const result = rollbackToSnapshot(session.projectPath, snapshotSha);
  if (!result.ok) return c.json({ error: result.error }, 500);

  if (typeof messageIndex === "number" && messageIndex >= 0) {
    session.events = session.events.slice(0, messageIndex);
    saveEventsNow(session);
  }

  return c.json({ ok: true });
});

app.post("/api/agent/rollback/force", async (c) => {
  const body = await c.req.json();
  const { projectId, snapshotSha, messageIndex, channel = "chat" } = body;

  if (!projectId || !snapshotSha) return c.json({ error: "projectId and snapshotSha required" }, 400);

  const session = agentSessions.get(sessionKey(projectId, channel));
  if (!session) return c.json({ error: "No session found" }, 404);

  const result = rollbackToSnapshot(session.projectPath, snapshotSha);
  if (!result.ok) return c.json({ error: result.error }, 500);

  if (typeof messageIndex === "number" && messageIndex >= 0) {
    session.events = session.events.slice(0, messageIndex);
    saveEventsNow(session);
  }

  return c.json({ ok: true });
});

app.get("/api/agent/:projectId/status", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const channel = (c.req.query("channel") as Channel) || "chat";
  const session = agentSessions.get(sessionKey(projectId, channel));
  if (!session) return c.json({ active: false, status: "none" });
  return c.json({
    active: session.status === "running",
    status: session.status,
    conversationId: session.conversationId,
    claudeSessionId: session.claudeSessionId,
    eventsCount: session.events.length,
  });
});

app.get("/api/agent/statuses", (c) => {
  const statuses: Record<number, string> = {};

  for (const [, session] of agentSessions) {
    if (session.channel !== "chat") continue;
    const projectId = session.projectId;
    if (session.status === "running") {
      statuses[projectId] = "running";
    } else if (session.events.length > 0) {
      const lastResult = [...session.events].reverse().find((e: any) => e.type === "result");
      statuses[projectId] = (lastResult as any)?.is_error ? "error" : "done";
    } else {
      statuses[projectId] = "idle";
    }
  }

  const allConvs = db
    .select()
    .from(conversations)
    .where(sql`channel = 'chat' AND events_json IS NOT NULL AND events_json != '[]'`)
    .all();

  for (const conv of allConvs) {
    if (!(conv.projectId in statuses)) {
      statuses[conv.projectId] = "done";
    }
  }

  return c.json(statuses);
});

app.use("/*", serveStatic({ root: STATIC_ROOT }));
app.get("/*", serveStatic({ root: STATIC_ROOT, path: "index.html" }));

export function startOverlordServer(port = PORT) {
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🏰 Overlord running at http://localhost:${info.port}`);
    console.log(`📁 Workspace directory: ${getWorkspaceRoot()}`);
  });

  const wss = new WebSocketServer({ server: server as never, path: "/ws" });
  setWebSocketServer(wss);
  attachWsHandlers(wss);

  return { server, wss, port };
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectRun) {
  startOverlordServer();
}

export { app, PORT, STATIC_ROOT };
