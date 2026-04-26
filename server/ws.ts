import { WebSocketServer, WebSocket } from "ws";

let wss: WebSocketServer | null = null;

export function setWebSocketServer(s: WebSocketServer) {
  wss = s;
}

export function getWebSocketServer(): WebSocketServer {
  if (!wss) throw new Error("WebSocketServer not initialized");
  return wss;
}

// Broadcast to ALL connected WebSockets (not just subscribers of a session)
export function broadcastAll(msg: object) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
