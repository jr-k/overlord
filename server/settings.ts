import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

type Settings = {
  workspaceRoot?: string;
};

const dataDir = join(homedir(), ".overlord");
const settingsPath = join(dataDir, "settings.json");
const fallbackWorkspaceRoot = process.env.OVERLORD_ROOT || resolve(process.cwd(), "..");

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(settings: Settings) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

export function getWorkspaceRoot() {
  return readSettings().workspaceRoot || fallbackWorkspaceRoot;
}

export function getWorkspaceSettings() {
  const settings = readSettings();
  const envConfigured = Boolean(process.env.OVERLORD_ROOT);
  const savedPath = settings.workspaceRoot;

  return {
    path: savedPath || fallbackWorkspaceRoot,
    configured: Boolean(savedPath || envConfigured),
    source: savedPath ? "user" : envConfigured ? "env" : "default",
  };
}

export function setWorkspaceRoot(path: string) {
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    throw new Error("Path required");
  }

  const workspaceRoot = resolve(trimmedPath);
  if (!existsSync(workspaceRoot)) {
    throw new Error("Directory not found");
  }
  if (!statSync(workspaceRoot).isDirectory()) {
    throw new Error("Path must be a directory");
  }

  writeSettings({ ...readSettings(), workspaceRoot });
  return getWorkspaceSettings();
}
