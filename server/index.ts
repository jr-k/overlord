import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { initDb, db } from "./db/index.js";
import { conversations, messages, projects, todos } from "./db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import projectRoutes from "./routes/projects.js";
import sessionRoutes from "./routes/sessions.js";
import conversationRoutes from "./routes/conversations.js";
import todoRoutes from "./routes/todos.js";

const PORT = Number(process.env.PORT) || 4747;
const ROOT_DIR = process.env.OVERLORD_ROOT || resolve(process.cwd(), "..");
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

initDb();

const app = new Hono();
app.use("/api/*", cors());
app.use("/api/*", async (c, next) => {
  c.set("rootDir" as never, ROOT_DIR as never);
  await next();
});

app.route("/api/projects", projectRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/todos", todoRoutes);

// Open system terminal in a directory
app.post("/api/terminal/open", async (c) => {
  const body = await c.req.json();
  const dir = body.path;
  if (!dir) return c.json({ error: "Path required" }, 400);

  const platform = process.platform;
  if (platform === "darwin") {
    spawn("open", ["-a", "Terminal", dir], { detached: true, stdio: "ignore" });
  } else if (platform === "linux") {
    // Try common terminal emulators
    for (const term of ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"]) {
      try {
        spawn(term, ["--working-directory", dir], { detached: true, stdio: "ignore" });
        break;
      } catch { continue; }
    }
  } else if (platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/K", `cd /d ${dir}`], { detached: true, stdio: "ignore" });
  }

  return c.json({ ok: true });
});

// Detect installed editors
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

import { execSync } from "child_process";

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

// RTK token savings per project
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

// Ask a question to another project's Claude agent
app.post("/api/agent/ask", async (c) => {
  const body = await c.req.json();
  const { projectId, question } = body;
  if (!projectId || !question) return c.json({ error: "projectId and question required" }, 400);

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  console.log(`[ask:${project.name}] "${question.slice(0, 80)}..."`);

  const result = await new Promise<{ ok: boolean; answer?: string; error?: string; code?: number | null }>((resolve) => {
    const proc = spawn(CLAUDE_PATH, [
      "--print",
      "--", question,
    ], {
      cwd: project.path,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    proc.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
    proc.stderr!.on("data", () => {});

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ ok: false, error: "Timeout (3min)", answer: output.trim() });
    }, 3 * 60 * 1000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[ask:${project.name}] done code=${code} (${output.length} chars)`);
      resolve({ ok: true, answer: output.trim(), code });
    });
  });

  return c.json({ ...result, project: project.name });
});

// Rollback to a git snapshot
app.post("/api/agent/rollback", async (c) => {
  const body = await c.req.json();
  const { projectId, snapshotSha, messageIndex } = body;

  if (!projectId || !snapshotSha) return c.json({ error: "projectId and snapshotSha required" }, 400);

  const session = agentSessions.get(projectId);
  if (!session) return c.json({ error: "No session found" }, 404);

  // Check if safe to rollback
  const commitsSince = getCommitsSince(session.projectPath, snapshotSha);
  if (commitsSince > 0) {
    return c.json({
      error: `${commitsSince} commit(s) ont ete faits depuis ce point. Le rollback ecraserait ces changements.`,
      commitsSince,
      needsConfirm: true,
    });
  }

  // Do the rollback
  const result = rollbackToSnapshot(session.projectPath, snapshotSha);
  if (!result.ok) {
    return c.json({ error: result.error }, 500);
  }

  // Trim events: remove everything from this message onwards
  if (typeof messageIndex === "number" && messageIndex >= 0) {
    session.events = session.events.slice(0, messageIndex);
    saveEventsNow(session);
  }

  return c.json({ ok: true });
});

// Force rollback (even with commits)
app.post("/api/agent/rollback/force", async (c) => {
  const body = await c.req.json();
  const { projectId, snapshotSha, messageIndex } = body;

  if (!projectId || !snapshotSha) return c.json({ error: "projectId and snapshotSha required" }, 400);

  const session = agentSessions.get(projectId);
  if (!session) return c.json({ error: "No session found" }, 404);

  const result = rollbackToSnapshot(session.projectPath, snapshotSha);
  if (!result.ok) return c.json({ error: result.error }, 500);

  if (typeof messageIndex === "number" && messageIndex >= 0) {
    session.events = session.events.slice(0, messageIndex);
    saveEventsNow(session);
  }

  return c.json({ ok: true });
});

app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("/*", serveStatic({ root: "./dist/client", path: "index.html" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏰 Overlord running at http://localhost:${info.port}`);
  console.log(`📁 Root directory: ${ROOT_DIR}`);
});

// ─── Session Manager ─────────────────────────────────────────
// One agent session per project. Each message spawns a claude --print process.
// Multi-turn is handled via --resume with the Claude session ID.

interface AgentSession {
  projectId: number;
  projectPath: string;
  conversationId: number;
  claudeSessionId: string | null; // Claude's internal session ID for --resume
  events: object[];               // All events for replay
  currentProcess: ChildProcess | null;
  status: "idle" | "running";
  subscribers: Set<WebSocket>;
}

const agentSessions = new Map<number, AgentSession>();

function broadcast(session: AgentSession, msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of session.subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// Broadcast to ALL connected WebSockets (not just subscribers of a session)
function broadcastAll(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// Debounced save — avoids blocking the event loop during heavy streaming
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();

function saveEvents(session: AgentSession) {
  const existing = saveTimers.get(session.projectId);
  if (existing) clearTimeout(existing);

  saveTimers.set(
    session.projectId,
    setTimeout(() => {
      saveTimers.delete(session.projectId);
      db.update(conversations)
        .set({
          eventsJson: JSON.stringify(session.events),
          claudeSessionId: session.claudeSessionId,
        })
        .where(eq(conversations.id, session.conversationId))
        .run();
    }, 2000)
  );
}

// Force save (used on process exit)
function saveEventsNow(session: AgentSession) {
  const existing = saveTimers.get(session.projectId);
  if (existing) clearTimeout(existing);
  saveTimers.delete(session.projectId);

  db.update(conversations)
    .set({
      eventsJson: JSON.stringify(session.events),
      claudeSessionId: session.claudeSessionId,
    })
    .where(eq(conversations.id, session.conversationId))
    .run();
}

function loadSessionFromDb(projectId: number, projectPath: string): AgentSession | null {
  // Find the latest conversation for this project that has events
  const conv = db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1)
    .get();

  if (!conv || !conv.eventsJson) return null;

  try {
    const events = JSON.parse(conv.eventsJson);
    return {
      projectId,
      projectPath,
      conversationId: conv.id,
      claudeSessionId: conv.claudeSessionId,
      events,
      currentProcess: null,
      status: "idle",
      subscribers: new Set(),
    };
  } catch {
    return null;
  }
}

function getOrCreateSession(projectId: number, projectPath: string): AgentSession {
  const existing = agentSessions.get(projectId);
  if (existing) return existing;

  // Try to restore from DB
  const restored = loadSessionFromDb(projectId, projectPath);
  if (restored) {
    agentSessions.set(projectId, restored);
    return restored;
  }

  const conv = db
    .insert(conversations)
    .values({ projectId, title: "Session" })
    .returning()
    .get();

  const session: AgentSession = {
    projectId,
    projectPath,
    conversationId: conv.id,
    claudeSessionId: null,
    events: [],
    currentProcess: null,
    status: "idle",
    subscribers: new Set(),
  };

  agentSessions.set(projectId, session);
  return session;
}

// ─── Git Snapshots ───────────────────────────────────────────

function createGitSnapshot(cwd: string): string | null {
  try {
    // Stage everything (including untracked) then create stash, then reset
    execSync("git add -A", { cwd, stdio: "ignore" });
    const sha = execSync("git stash create", { cwd, encoding: "utf-8", timeout: 5000 }).trim();
    execSync("git reset", { cwd, stdio: "ignore" });

    if (!sha) {
      // No changes to snapshot — return current HEAD
      return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    }
    return sha;
  } catch (err) {
    console.log(`[git] snapshot failed:`, err);
    return null;
  }
}

function getCommitsSince(cwd: string, sha: string): number {
  try {
    // Count commits between sha and HEAD
    const count = execSync(`git rev-list --count ${sha}..HEAD`, { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return -1; // Can't determine
  }
}

function rollbackToSnapshot(cwd: string, sha: string): { ok: boolean; error?: string } {
  try {
    // Check for commits since snapshot
    const commitsSince = getCommitsSince(cwd, sha);
    if (commitsSince > 0) {
      return { ok: false, error: `${commitsSince} commit(s) depuis ce snapshot. Rollback non securise.` };
    }

    // Restore files from the snapshot
    execSync(`git checkout ${sha} -- .`, { cwd, stdio: "ignore", timeout: 10000 });
    // Clean untracked files that Claude may have created
    execSync("git clean -fd --exclude=node_modules --exclude=.env", { cwd, stdio: "ignore", timeout: 10000 });
    // Unstage everything
    execSync("git reset", { cwd, stdio: "ignore" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function sendMessage(session: AgentSession, message: string) {
  if (session.currentProcess) {
    console.log(`[agent:${session.projectId}] already running, queuing not implemented`);
    return;
  }

  // Git snapshot before Claude works
  const snapshotSha = createGitSnapshot(session.projectPath);
  console.log(`[agent:${session.projectId}] snapshot: ${snapshotSha ?? "none"}`);

  // Store user message with snapshot SHA in events
  const eventIndex = session.events.length;
  session.events.push({ type: "user_message", content: message, snapshotSha });
  saveEvents(session);
  db.insert(messages)
    .values({ conversationId: session.conversationId, role: "user", content: message })
    .run();

  // Notify clients of the snapshot so the rollback button appears immediately
  broadcast(session, { type: "agent:snapshot", snapshotSha, eventIndex, message });

  // MCP config pointing to Overlord's MCP server
  const tsxBin = resolve(__dirname, "..", "node_modules", ".bin", "tsx");
  const mcpConfig = JSON.stringify({
    mcpServers: {
      overlord: {
        command: tsxBin,
        args: [resolve(__dirname, "mcp.ts")],
        env: { OVERLORD_PORT: String(PORT) },
      },
    },
  });

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--append-system-prompt", "Match the language of the user's message in your response. When you respond in French, always use proper accents (é, è, ê, à, â, ù, û, ç, ô, etc.) — never write French without accents.",
    "--mcp-config", mcpConfig,
    "--allowedTools", "Edit", "Write", "Read", "Bash", "Glob", "Grep", "NotebookEdit",
    "WebFetch", "WebSearch", "ToolSearch", "Agent",
    "mcp__overlord__overlord_list_todos", "mcp__overlord__overlord_add_todo",
    "mcp__overlord__overlord_complete_todo", "mcp__overlord__overlord_delete_todo",
    "mcp__overlord__overlord_list_projects", "mcp__overlord__overlord_get_project",
    "mcp__overlord__overlord_ask_project",
  ];

  // Resume previous conversation if we have a session ID
  if (session.claudeSessionId) {
    args.push("--resume", session.claudeSessionId);
  }

  // -- separates options from the prompt argument
  args.push("--", message);

  console.log(`[agent:${session.projectId}] spawning: claude ${args.join(" ").slice(0, 100)}...`);

  const proc = spawn(CLAUDE_PATH, args, {
    cwd: session.projectPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  console.log(`[agent:${session.projectId}] pid=${proc.pid}`);

  session.currentProcess = proc;
  session.status = "running";
  broadcast(session, { type: "agent:running" });
  broadcastAll({ type: "agent:status_change", projectId: session.projectId, status: "running" });

  // Parse stdout line by line
  let buffer = "";
  proc.stdout!.on("data", (data: Buffer) => {
    resetActivityTimer();
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        session.events.push(event);

        // Extract Claude session ID from init event
        if (event.type === "system" && event.subtype === "init" && event.session_id) {
          session.claudeSessionId = event.session_id;
          console.log(`[agent:${session.projectId}] session_id=${event.session_id}`);
        }

        console.log(`[agent:${session.projectId}] ${event.type}${event.subtype ? `:${event.subtype}` : ""}`);
        broadcast(session, { type: "agent:event", event, eventIndex: session.events.length });
        saveEvents(session);
      } catch {
        broadcast(session, { type: "agent:raw", data: line });
      }
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    resetActivityTimer();
    console.log(`[agent:${session.projectId}] stderr: ${data.toString().slice(0, 500)}`);
  });

  // Timeout: kill if no output for 5 minutes
  let activityTimer = setTimeout(() => {
    console.log(`[agent:${session.projectId}] timeout — no activity for 5 minutes, killing`);
    proc.kill("SIGTERM");
  }, 5 * 60 * 1000);

  const resetActivityTimer = () => {
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      console.log(`[agent:${session.projectId}] timeout — no activity for 5 minutes, killing`);
      proc.kill("SIGTERM");
    }, 5 * 60 * 1000);
  };

  proc.on("error", (err) => {
    clearTimeout(activityTimer);
    console.log(`[agent:${session.projectId}] process error: ${err.message}`);
    session.currentProcess = null;
    session.status = "idle";
    broadcast(session, { type: "agent:done", code: 1 });
    broadcastAll({ type: "agent:status_change", projectId: session.projectId, status: "error" });
  });

  proc.on("close", (code) => {
    clearTimeout(activityTimer);
    console.log(`[agent:${session.projectId}] done code=${code}`);
    session.currentProcess = null;
    session.status = "idle";
    saveEventsNow(session);
    broadcast(session, { type: "agent:done", code });
    const finalStatus = code === 0 ? "done" : "error";
    broadcastAll({ type: "agent:status_change", projectId: session.projectId, status: finalStatus });

    // Auto-generate project summary after successful conversation
    if (code === 0) {
      generateSummary(session);
    }
  });
}

// Generate a project summary after a conversation ends
function generateSummary(session: AgentSession) {
  // Extract user messages and assistant results from events
  const exchanges: string[] = [];
  for (const ev of session.events.slice(-20) as any[]) {
    if (ev.type === "user_message") {
      exchanges.push(`User: ${ev.content}`);
    } else if (ev.type === "result" && ev.result) {
      exchanges.push(`Assistant: ${ev.result.slice(0, 500)}`);
    }
  }

  if (exchanges.length === 0) return;

  const prompt = `Tu es un assistant qui genere des resumes de projet. Voici les derniers echanges sur ce projet. Genere un resume concis (3-5 lignes max) qui repond a: 1) C'est quoi ce projet ? 2) Quelles sont les dernieres choses faites ? Reponds uniquement avec le resume, pas de preamble.\n\n${exchanges.join("\n\n")}`;

  console.log(`[summary:${session.projectId}] generating summary...`);

  const proc = spawn(CLAUDE_PATH, [
    "--print",
    "--", prompt,
  ], {
    cwd: session.projectPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout!.on("data", (data: Buffer) => {
    output += data.toString();
  });

  proc.on("close", (code) => {
    if (code === 0 && output.trim()) {
      console.log(`[summary:${session.projectId}] saved (${output.trim().length} chars)`);
      db.update(projects)
        .set({
          summary: output.trim(),
          lastSummaryAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(projects.id, session.projectId))
        .run();
    } else {
      console.log(`[summary:${session.projectId}] failed code=${code}`);
    }
  });
}

function stopAgent(projectId: number) {
  const session = agentSessions.get(projectId);
  if (!session || !session.currentProcess) return false;
  console.log(`[agent:${projectId}] stopping (SIGTERM)`);
  session.currentProcess.kill("SIGTERM");
  return true;
}

// ─── API ─────────────────────────────────────────────────────

app.get("/api/agent/:projectId/status", (c) => {
  const projectId = Number(c.req.param("projectId"));
  const session = agentSessions.get(projectId);
  if (!session) return c.json({ active: false, status: "none" });
  return c.json({
    active: session.status === "running",
    status: session.status,
    conversationId: session.conversationId,
    claudeSessionId: session.claudeSessionId,
    eventsCount: session.events.length,
  });
});

// Returns agent status for all projects
app.get("/api/agent/statuses", (c) => {
  const statuses: Record<number, string> = {};

  // In-memory sessions
  for (const [projectId, session] of agentSessions) {
    if (session.status === "running") {
      statuses[projectId] = "running";
    } else if (session.events.length > 0) {
      // Check if last result was an error
      const lastResult = [...session.events].reverse().find((e: any) => e.type === "result");
      statuses[projectId] = (lastResult as any)?.is_error ? "error" : "done";
    } else {
      statuses[projectId] = "idle";
    }
  }

  // Check DB for projects that had sessions before server restart
  const allConvs = db
    .select()
    .from(conversations)
    .where(sql`events_json IS NOT NULL AND events_json != '[]'`)
    .all();

  for (const conv of allConvs) {
    if (!(conv.projectId in statuses)) {
      statuses[conv.projectId] = "done";
    }
  }

  return c.json(statuses);
});

// ─── WebSocket ───────────────────────────────────────────────

const wss = new WebSocketServer({ server: server as never, path: "/ws" });
const wsSubscriptions = new Map<WebSocket, number>();

wss.on("connection", (ws) => {
  console.log("[ws] new connection");

  ws.on("message", (raw) => {
    const text = raw.toString();
    console.log(`[ws] received: ${text.slice(0, 200)}`);
    try {
      const msg = JSON.parse(text);
      handleWsMessage(ws, msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", data: "Invalid message" }));
    }
  });

  ws.on("close", () => {
    const projectId = wsSubscriptions.get(ws);
    if (projectId !== undefined) {
      agentSessions.get(projectId)?.subscribers.delete(ws);
    }
    wsSubscriptions.delete(ws);
  });
});

type WsMessage =
  | { type: "subscribe"; projectId: number; projectPath: string }
  | { type: "chat"; projectId: number; projectPath: string; message: string }
  | { type: "stop"; projectId: number };

function handleWsMessage(ws: WebSocket, msg: WsMessage) {
  if (msg.type === "stop") {
    stopAgent(msg.projectId);
    return;
  } else if (msg.type === "subscribe") {
    // Unsubscribe from previous
    const prevId = wsSubscriptions.get(ws);
    if (prevId !== undefined) {
      agentSessions.get(prevId)?.subscribers.delete(ws);
    }
    wsSubscriptions.set(ws, msg.projectId);

    // Try in-memory first, then DB
    let session = agentSessions.get(msg.projectId);
    if (!session) {
      const restored = loadSessionFromDb(msg.projectId, msg.projectPath);
      if (restored) {
        agentSessions.set(msg.projectId, restored);
        session = restored;
      }
    }

    if (session) {
      // Always add as subscriber so we get live events (even during running)
      session.subscribers.add(ws);

      if (session.events.length > 0) {
        ws.send(JSON.stringify({
          type: "agent:history",
          events: session.events,
          status: session.status,
          eventCount: session.events.length,
        }));
      } else {
        ws.send(JSON.stringify({ type: "agent:ready", projectId: msg.projectId }));
      }
    } else {
      ws.send(JSON.stringify({ type: "agent:ready", projectId: msg.projectId }));
    }
  } else if (msg.type === "chat") {
    const session = getOrCreateSession(msg.projectId, msg.projectPath);
    session.subscribers.add(ws);
    wsSubscriptions.set(ws, msg.projectId);

    broadcast(session, { type: "agent:start", message: msg.message });
    sendMessage(session, msg.message);
  }
}

import { existsSync, statSync } from "fs";

export { app, PORT, ROOT_DIR };
