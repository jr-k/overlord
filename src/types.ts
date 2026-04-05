export interface Project {
  id: number;
  name: string;
  path: string;
  status: "active" | "paused" | "blocked";
  favorite: boolean;
  hidden: boolean;
  summary: string | null;
  lastSummaryAt: string | null;
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

export interface WorkspaceInfo {
  type: "pnpm" | "yarn" | "npm" | "nx" | "lerna" | null;
  packages: WorkspacePackage[];
}

export interface WorkspacePackage {
  name: string;
  path: string;
  fullPath: string;
  category: "app" | "package" | "other";
  packageJson?: { name?: string; version?: string; description?: string };
}

export interface Todo {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  done: boolean;
  sortOrder: number;
  createdAt: string;
}
