import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { resolve } from "path";
import { initDb, db } from "./db/index.js";
import { conversations, messages } from "./db/schema.js";
import projectRoutes from "./routes/projects.js";
import sessionRoutes from "./routes/sessions.js";
import conversationRoutes from "./routes/conversations.js";

const PORT = Number(process.env.PORT) || 4747;
const ROOT_DIR = process.env.OVERLORD_ROOT || resolve(process.cwd(), "..");

// Initialize DB
initDb();

const app = new Hono();

// CORS for dev mode (Vite runs on different port)
app.use("/api/*", cors());

// Store rootDir in context for routes
app.use("/api/*", async (c, next) => {
  c.set("rootDir" as never, ROOT_DIR as never);
  await next();
});

// API routes
app.route("/api/projects", projectRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/conversations", conversationRoutes);

// Serve frontend in production
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("/*", serveStatic({ root: "./dist/client", path: "index.html" }));

// Start HTTP server
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏰 Overlord running at http://localhost:${info.port}`);
  console.log(`📁 Root directory: ${ROOT_DIR}`);
});

// WebSocket server for Claude chat
const wss = new WebSocketServer({ server: server as never, path: "/ws" });

// Track active Claude PTY sessions per WebSocket
interface ClaudeSession {
  pty: IPty;
  conversationId: number;
  buffer: string;
}

const claudeSessions = new Map<WebSocket, ClaudeSession>();

// Strip ANSI escape codes for clean storage
function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleWsMessage(ws, msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", data: "Invalid message" }));
    }
  });

  ws.on("close", () => {
    const session = claudeSessions.get(ws);
    if (session) {
      // Save accumulated buffer before killing
      saveSessionBuffer(session);
      session.pty.kill();
      claudeSessions.delete(ws);
    }
  });
});

type WsMessage =
  | {
      type: "chat";
      projectPath: string;
      projectId: number;
      message: string;
      resume?: boolean;
    }
  | { type: "input"; data: string };

function handleWsMessage(ws: WebSocket, msg: WsMessage) {
  if (msg.type === "chat") {
    startClaudeSession(ws, msg);
  } else if (msg.type === "input") {
    // Forward user keystrokes to the PTY
    const session = claudeSessions.get(ws);
    if (session) {
      session.pty.write(msg.data);
    }
  }
}

function startClaudeSession(
  ws: WebSocket,
  msg: Extract<WsMessage, { type: "chat" }>
) {
  // If there's an existing session, send message to it instead of creating new one
  const existing = claudeSessions.get(ws);
  if (existing) {
    // Send the new message to the existing Claude session
    existing.pty.write(msg.message + "\r");

    // Save user message to DB
    db.insert(messages)
      .values({
        conversationId: existing.conversationId,
        role: "user",
        content: msg.message,
      })
      .run();

    ws.send(JSON.stringify({ type: "chat:start", conversationId: existing.conversationId }));
    return;
  }

  const args: string[] = [];
  if (msg.resume) {
    args.push("--resume");
  }

  // Spawn Claude in a real PTY — full interactive mode with tools
  const shell = pty.spawn("claude", args, {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: msg.projectPath,
    env: process.env as Record<string, string>,
  });

  // Create conversation record
  const conv = db
    .insert(conversations)
    .values({
      projectId: msg.projectId,
      title: msg.message.slice(0, 100),
    })
    .returning()
    .get();

  // Save user message
  db.insert(messages)
    .values({
      conversationId: conv.id,
      role: "user",
      content: msg.message,
    })
    .run();

  const session: ClaudeSession = {
    pty: shell,
    conversationId: conv.id,
    buffer: "",
  };

  claudeSessions.set(ws, session);

  ws.send(JSON.stringify({ type: "chat:start", conversationId: conv.id }));

  // Send the initial message after a short delay for Claude to initialize
  setTimeout(() => {
    shell.write(msg.message + "\r");
  }, 500);

  // Stream PTY output to WebSocket
  shell.onData((data: string) => {
    session.buffer += data;
    ws.send(JSON.stringify({ type: "chat:chunk", data }));
  });

  shell.onExit(({ exitCode }) => {
    saveSessionBuffer(session);
    ws.send(JSON.stringify({ type: "chat:end", code: exitCode }));
    claudeSessions.delete(ws);
  });
}

function saveSessionBuffer(session: ClaudeSession) {
  const clean = stripAnsi(session.buffer);
  if (clean.trim()) {
    db.insert(messages)
      .values({
        conversationId: session.conversationId,
        role: "assistant",
        content: clean,
      })
      .run();
  }
  session.buffer = "";
}

export { app, PORT, ROOT_DIR };
