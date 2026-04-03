export interface Project {
  id: number;
  name: string;
  path: string;
  status: "active" | "paused" | "blocked";
  createdAt: string;
  updatedAt: string;
  latestSession?: Session | null;
}

export interface Session {
  id: number;
  projectId: number;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface Conversation {
  id: number;
  projectId: number;
  claudeSessionId: string | null;
  title: string | null;
  createdAt: string;
  lastResumedAt: string | null;
}
