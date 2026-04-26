import { WebSocketServer, WebSocket } from "ws";
import {
  agentSessions,
  sessionKey,
  loadSessionFromDb,
  getOrCreateSession,
  broadcast,
  stopAgent,
} from "./sessions.js";
import { sendMessage } from "./send-message.js";
import type { Channel } from "./types.js";

const HISTORY_PAGE_SIZE = 500;

type WsMessage =
  | { type: "subscribe"; projectId: number; projectPath: string; channel?: Channel }
  | { type: "chat"; projectId: number; projectPath: string; message: string; channel?: Channel }
  | { type: "stop"; projectId: number; channel?: Channel }
  | { type: "loadOlder"; projectId: number; channel?: Channel; beforeIndex: number; limit?: number };

export function attachWsHandlers(wss: WebSocketServer) {
  const wsSubscriptions = new Map<WebSocket, string>();

  wss.on("connection", (ws) => {
    console.log("[ws] new connection");

    ws.on("message", (raw) => {
      const text = raw.toString();
      console.log(`[ws] received: ${text.slice(0, 200)}`);
      try {
        const msg = JSON.parse(text) as WsMessage;
        handleWsMessage(ws, msg, wsSubscriptions);
      } catch {
        ws.send(JSON.stringify({ type: "error", data: "Invalid message" }));
      }
    });

    ws.on("close", () => {
      const key = wsSubscriptions.get(ws);
      if (key !== undefined) {
        agentSessions.get(key)?.subscribers.delete(ws);
      }
      wsSubscriptions.delete(ws);
    });
  });
}

function handleWsMessage(ws: WebSocket, msg: WsMessage, wsSubscriptions: Map<WebSocket, string>) {
  const channel: Channel = msg.channel ?? "chat";

  if (msg.type === "stop") {
    stopAgent(msg.projectId, channel);
    return;
  }

  if (msg.type === "subscribe") {
    const prevKey = wsSubscriptions.get(ws);
    if (prevKey !== undefined) {
      agentSessions.get(prevKey)?.subscribers.delete(ws);
    }
    const key = sessionKey(msg.projectId, channel);
    wsSubscriptions.set(ws, key);

    let session = agentSessions.get(key);
    if (!session) {
      const restored = loadSessionFromDb(msg.projectId, msg.projectPath, channel);
      if (restored) {
        agentSessions.set(key, restored);
        session = restored;
      }
    }

    if (session) {
      session.subscribers.add(ws);

      if (session.events.length > 0) {
        const total = session.events.length;
        const start = Math.max(0, total - HISTORY_PAGE_SIZE);
        ws.send(JSON.stringify({
          type: "agent:history",
          events: session.events.slice(start),
          status: session.status,
          eventCount: total,
          firstLoadedIndex: start,
          totalEvents: total,
        }));
      } else {
        ws.send(JSON.stringify({ type: "agent:ready", projectId: msg.projectId }));
      }
    } else {
      ws.send(JSON.stringify({ type: "agent:ready", projectId: msg.projectId }));
    }
    return;
  }

  if (msg.type === "loadOlder") {
    const session = agentSessions.get(sessionKey(msg.projectId, channel));
    if (!session) {
      ws.send(JSON.stringify({ type: "agent:older", events: [], firstLoadedIndex: 0, hasMore: false }));
      return;
    }
    const limit = Math.max(1, Math.min(2000, msg.limit ?? HISTORY_PAGE_SIZE));
    const before = Math.max(0, Math.min(msg.beforeIndex, session.events.length));
    const start = Math.max(0, before - limit);
    ws.send(JSON.stringify({
      type: "agent:older",
      events: session.events.slice(start, before),
      firstLoadedIndex: start,
      hasMore: start > 0,
    }));
    return;
  }

  if (msg.type === "chat") {
    const session = getOrCreateSession(msg.projectId, msg.projectPath, channel);
    const key = sessionKey(msg.projectId, channel);
    session.subscribers.add(ws);
    wsSubscriptions.set(ws, key);

    broadcast(session, { type: "agent:start", message: msg.message });
    sendMessage(session, msg.message);
  }
}
