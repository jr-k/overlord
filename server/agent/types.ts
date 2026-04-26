import type { ChildProcess } from "child_process";
import type { WebSocket } from "ws";

export type Channel = "chat" | "marketing";

export interface AgentSession {
  projectId: number;
  projectPath: string;
  channel: Channel;
  conversationId: number;
  claudeSessionId: string | null;
  events: object[];
  currentProcess: ChildProcess | null;
  status: "idle" | "running";
  subscribers: Set<WebSocket>;
}
