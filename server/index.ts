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

function saveEvents(session: AgentSession) {
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

function sendMessage(session: AgentSession, message: string) {
  if (session.currentProcess) {
    console.log(`[agent:${session.projectId}] already running, queuing not implemented`);
    return;
  }

  // MCP config pointing to Overlord's MCP server
  const mcpConfig = JSON.stringify({
    mcpServers: {
      overlord: {
        command: "npx",
        args: ["tsx", resolve(__dirname, "mcp.ts")],
        env: { OVERLORD_PORT: String(PORT) },
      },
    },
  });

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config", mcpConfig,
    "--allowedTools", "Edit", "Write", "Read", "Bash", "Glob", "Grep", "NotebookEdit",
    "mcp__overlord__overlord_list_todos", "mcp__overlord__overlord_add_todo",
    "mcp__overlord__overlord_complete_todo", "mcp__overlord__overlord_delete_todo",
    "mcp__overlord__overlord_list_projects", "mcp__overlord__overlord_get_project",
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

  // Store user message in events (for replay) and DB
  session.events.push({ type: "user_message", content: message });
  saveEvents(session);
  db.insert(messages)
    .values({ conversationId: session.conversationId, role: "user", content: message })
    .run();

  // Parse stdout line by line
  let buffer = "";
  proc.stdout!.on("data", (data: Buffer) => {
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
        broadcast(session, { type: "agent:event", event });
        saveEvents(session);
      } catch {
        broadcast(session, { type: "agent:raw", data: line });
      }
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    console.log(`[agent:${session.projectId}] stderr: ${data.toString().slice(0, 200)}`);
  });

  proc.on("close", (code) => {
    console.log(`[agent:${session.projectId}] done code=${code}`);
    session.currentProcess = null;
    session.status = "idle";
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
      // Route terminal messages separately
      if (msg.type?.startsWith("term:")) {
        handleTerminalMessage(ws, msg);
      } else {
        handleWsMessage(ws, msg);
      }
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
    // Detach terminals (don't kill — they survive reconnects)
    for (const state of terminalStates.values()) {
      if (state.subscriber === ws) {
        state.subscriber = null;
      }
    }
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

    if (session && session.events.length > 0) {
      session.subscribers.add(ws);
      ws.send(JSON.stringify({
        type: "agent:history",
        events: session.events,
        status: session.status,
      }));
    } else {
      ws.send(JSON.stringify({ type: "agent:ready", projectId: msg.projectId }));
    }
  } else if (msg.type === "chat") {
    const session = getOrCreateSession(msg.projectId, msg.projectPath);
    session.subscribers.add(ws);
    wsSubscriptions.set(ws, msg.projectId);

    broadcast(session, { type: "agent:start" });
    sendMessage(session, msg.message);
  }
}

// ─── Terminal (multiplexed on main WS) ──────────────────────

interface TerminalState {
  cwd: string;
  currentProc: ChildProcess | null;
  outputHistory: string[]; // Keep last N lines for replay on reconnect
  subscriber: WebSocket | null;
}

// Terminals keyed by termId — survive WS disconnects
const terminalStates = new Map<string, TerminalState>();
const MAX_TERMINAL_HISTORY = 200;

import { existsSync, statSync, readdirSync } from "fs";

function termSend(state: TerminalState, msg: object) {
  if (state.subscriber?.readyState === WebSocket.OPEN) {
    state.subscriber.send(JSON.stringify(msg));
  }
}

function handleTerminalMessage(ws: WebSocket, msg: any) {
  const termId = msg.termId as string;
  if (!termId) return;

  if (msg.type === "term:start") {
    const existing = terminalStates.get(termId);
    if (existing) {
      // Reconnect to existing terminal
      console.log(`[terminal:${termId}] reconnect (${existing.outputHistory.length} lines buffered)`);
      existing.subscriber = ws;
      // Replay history
      ws.send(JSON.stringify({
        type: "term:history",
        termId,
        lines: existing.outputHistory,
        cwd: existing.cwd,
        running: existing.currentProc !== null,
      }));
      return;
    }

    console.log(`[terminal:${termId}] start in ${msg.cwd}`);
    const state: TerminalState = {
      cwd: msg.cwd || ROOT_DIR,
      currentProc: null,
      outputHistory: [],
      subscriber: ws,
    };
    terminalStates.set(termId, state);
    ws.send(JSON.stringify({
      type: "term:cwd",
      termId,
      cwd: msg.cwd || ROOT_DIR,
    }));
  } else if (msg.type === "term:command") {
    const state = terminalStates.get(termId);
    if (!state) return;
    state.subscriber = ws; // Always update subscriber

    const cmd = msg.data?.trim();
    if (!cmd) return;

    console.log(`[terminal:${termId}] exec: ${cmd.slice(0, 80)}`);

    // Store the command in history
    state.outputHistory.push(`$ ${cmd}`);
    if (state.outputHistory.length > MAX_TERMINAL_HISTORY) {
      state.outputHistory.splice(0, state.outputHistory.length - MAX_TERMINAL_HISTORY);
    }

    // Handle cd
    if (cmd.startsWith("cd ")) {
      const target = cmd.slice(3).trim().replace(/^~/, process.env.HOME || "");
      const resolved = resolve(state.cwd, target);
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        state.cwd = resolved;
        termSend(state, { type: "term:cwd", termId, cwd: resolved });
      } else {
        const err = `cd: no such directory: ${target}\n`;
        state.outputHistory.push(err);
        termSend(state, { type: "term:data", termId, data: err });
      }
      termSend(state, { type: "term:done", termId, code: 0 });
      return;
    }

    const proc = spawn("bash", ["-c", cmd], {
      cwd: state.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.currentProc = proc;

    proc.stdout!.on("data", (data: Buffer) => {
      const text = data.toString();
      state.outputHistory.push(text);
      if (state.outputHistory.length > MAX_TERMINAL_HISTORY) {
        state.outputHistory.splice(0, state.outputHistory.length - MAX_TERMINAL_HISTORY);
      }
      termSend(state, { type: "term:data", termId, data: text });
    });

    proc.stderr!.on("data", (data: Buffer) => {
      const text = data.toString();
      state.outputHistory.push(text);
      termSend(state, { type: "term:data", termId, data: text });
    });

    proc.on("close", (code) => {
      state.currentProc = null;
      if (code !== 0) {
        state.outputHistory.push(`[exit ${code}]`);
      }
      termSend(state, { type: "term:done", termId, code });
    });
  } else if (msg.type === "term:complete") {
    const state = terminalStates.get(termId);
    if (!state) return;

    const partial = (msg.data ?? "") as string;
    // Get the last "word" being typed
    const parts = partial.split(/\s+/);
    const lastWord = parts[parts.length - 1] || "";

    // Determine directory and prefix to complete
    const lastSlash = lastWord.lastIndexOf("/");
    const dir = lastSlash >= 0 ? resolve(state.cwd, lastWord.slice(0, lastSlash + 1)) : state.cwd;
    const prefix = lastSlash >= 0 ? lastWord.slice(lastSlash + 1) : lastWord;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const matches = entries
        .filter((e) => !e.name.startsWith(".") && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((e) => e.name + (e.isDirectory() ? "/" : ""))
        .sort();

      ws.send(JSON.stringify({
        type: "term:completions",
        termId,
        matches,
        prefix,
      }));
    } catch {
      ws.send(JSON.stringify({ type: "term:completions", termId, matches: [], prefix }));
    }
  } else if (msg.type === "term:kill") {
    const state = terminalStates.get(termId);
    if (state?.currentProc) state.currentProc.kill("SIGTERM");
  } else if (msg.type === "term:close") {
    const state = terminalStates.get(termId);
    if (state?.currentProc) state.currentProc.kill();
    terminalStates.delete(termId);
  }
}

export { app, PORT, ROOT_DIR };
