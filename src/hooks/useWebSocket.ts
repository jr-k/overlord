import { useRef, useCallback, useEffect, useState } from "react";

export interface WsMessage {
  type: string;
  data?: string;
  conversationId?: number;
  code?: number;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data);
      setMessages((prev) => [...prev, msg]);

      if (msg.type === "chat:start") setStreaming(true);
      if (msg.type === "chat:end") setStreaming(false);
    };

    return () => ws.close();
  }, []);

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { connected, messages, streaming, send, clearMessages };
}
