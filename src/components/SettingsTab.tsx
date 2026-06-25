import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Check, SearchCode, Trash2 } from "lucide-react";
import { patch } from "../hooks/useApi.js";
import type { Project } from "../types.js";

import { useModels } from "../hooks/useModels.js";

export const DEFAULT_TOOLS = [
  "Edit", "Write", "Read", "Bash", "Glob", "Grep", "NotebookEdit",
  "WebFetch", "WebSearch", "ToolSearch", "Agent",
];

export const OVERLORD_MCP_TOOLS = [
  "mcp__overlord__overlord_list_todos",
  "mcp__overlord__overlord_add_todo",
  "mcp__overlord__overlord_complete_todo",
  "mcp__overlord__overlord_delete_todo",
  "mcp__overlord__overlord_list_projects",
  "mcp__overlord__overlord_get_project",
  "mcp__overlord__overlord_ask_project",
];

const DEFAULT_SYSTEM_PROMPT = "Match the language of the user's message in your response. When you respond in French, always use proper French accents.";

interface Props {
  project: Project;
}

export function SettingsTab({ project }: Props) {
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? "");
  const [model, setModel] = useState(project.model ?? "");
  const models = useModels();
  const [learningsEnabled, setLearningsEnabled] = useState(project.learningsEnabled ?? true);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => {
    if (project.allowedTools) {
      try { return new Set(JSON.parse(project.allowedTools)); } catch {}
    }
    return new Set([...DEFAULT_TOOLS, ...OVERLORD_MCP_TOOLS]);
  });
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [effectivePrompt, setEffectivePrompt] = useState<{
    base: string;
    nudges: { name: string; content: string; reason: string }[];
    full: string;
  } | null>(null);
  const [showEffective, setShowEffective] = useState(false);

  useEffect(() => {
    setSystemPrompt(project.systemPrompt ?? "");
    setModel(project.model ?? "");
    setLearningsEnabled(project.learningsEnabled ?? true);
    setDirty(false);
  }, [project.id]);

  // Re-fetch the effective prompt whenever the saved settings change
  useEffect(() => {
    fetch(`/api/projects/${project.id}/system-prompt?channel=chat`)
      .then((r) => r.json())
      .then((data) => setEffectivePrompt(data))
      .catch(() => setEffectivePrompt(null));
  }, [project.id, saved]);

  const toggleTool = useCallback((tool: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    await patch(`/projects/${project.id}`, {
      systemPrompt: systemPrompt || null,
      model: model || null,
      allowedTools: JSON.stringify([...selectedTools]),
      learningsEnabled,
    });
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2000);
  }, [project.id, systemPrompt, model, selectedTools, learningsEnabled]);

  const handleReset = useCallback(() => {
    setSystemPrompt("");
    setModel("");
    setSelectedTools(new Set([...DEFAULT_TOOLS, ...OVERLORD_MCP_TOOLS]));
    setDirty(true);
  }, []);

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agent settings for {project.name}</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset to defaults
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty && !saved}>
            {saved ? (
              <>
                <Check className="h-3 w-3 mr-1" /> Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* System prompt */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">System prompt</CardTitle>
              <CardDescription className="text-xs">
                Appended to Claude's default system prompt. Default: {DEFAULT_SYSTEM_PROMPT}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); setDirty(true); }}
                placeholder={DEFAULT_SYSTEM_PROMPT}
                className="min-h-[120px] resize-y font-mono text-xs"
              />

              {effectivePrompt && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold">
                      Effective prompt sent to Claude
                      {effectivePrompt.nudges.length > 0 && (
                        <span className="ml-2 text-[10px] text-emerald-400 font-normal">
                          + {effectivePrompt.nudges.length} auto-nudge{effectivePrompt.nudges.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowEffective((s) => !s)}>
                      {showEffective ? "Hide" : "Show"}
                    </Button>
                  </div>
                  {effectivePrompt.nudges.length > 0 && (
                    <div className="space-y-1">
                      {effectivePrompt.nudges.map((n) => (
                        <div key={n.name} className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px]">
                          <span className="font-semibold text-emerald-400">{n.name}</span>
                          <span className="ml-2 text-muted-foreground">{n.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {showEffective && (
                    <pre className="max-h-[300px] overflow-auto rounded-md border border-border bg-secondary/50 p-3 text-[11px] font-mono whitespace-pre-wrap select-text">
                      {effectivePrompt.full}
                    </pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Allowed tools */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Allowed tools</CardTitle>
              <CardDescription className="text-xs">
                Tools the agent is allowed to use without asking permission.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Built-in tools
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_TOOLS.map((tool) => (
                    <ToolToggle key={tool} tool={tool} selected={selectedTools.has(tool)} onToggle={toggleTool} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Overlord MCP tools
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {OVERLORD_MCP_TOOLS.map((tool) => (
                    <ToolToggle
                      key={tool}
                      tool={tool}
                      label={tool.replace("mcp__overlord__overlord_", "")}
                      selected={selectedTools.has(tool)}
                      onToggle={toggleTool}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex w-full flex-col gap-4 xl:w-[380px] xl:shrink-0">
          {/* Indexing */}
          <IndexingCard project={project} />

          {/* Model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Model</CardTitle>
              <CardDescription className="text-xs">
                Claude model to use for this project. Empty = use Claude CLI default.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); setDirty(true); }}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Session analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Session analysis</CardTitle>
              <CardDescription className="text-xs">
                {"At the end of each chat conversation (at least 3 tool uses or messages), Overlord starts a Claude agent that analyzes the session and extracts learnings (dead ends, missing context, recommendations), visible in the Summary tab."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={learningsEnabled}
                  onChange={(e) => { setLearningsEnabled(e.target.checked); setDirty(true); }}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span>Enable automatic analysis after each session</span>
              </label>
              {!learningsEnabled && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Disabled: sessions will no longer be analyzed. This saves tokens and time, but you will no longer get automatic feedback.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Danger zone */}
          <DangerZoneCard project={project} />
        </div>
      </div>
    </div>
  );
}

function DangerZoneCard({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = project.name;
  const canDelete = confirmText === expected;

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${project.id}?deleteFolder=${deleteFolder}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setDeleting(false);
        return;
      }
      localStorage.removeItem("overlord:projectId");
      window.location.reload();
    } catch (err) {
      setError(String(err));
      setDeleting(false);
    }
  }, [project.id, deleteFolder]);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </CardTitle>
        <CardDescription className="text-xs">
          Delete this project from Overlord and all its data (chats, todos, marketing, settings).
          Optionally, also delete the folder from disk.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 w-fit"
        >
          <Trash2 className="h-3 w-3" />
          Delete this project...
        </Button>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (deleting) return;
            setOpen(nextOpen);
            if (!nextOpen) {
              setDeleteFolder(false);
              setConfirmText("");
              setError(null);
            }
          }}
        >
          <DialogContent showCloseButton={!deleting} className="overflow-hidden border-destructive/30 p-0 sm:max-w-lg">
            <div className="p-5">
              <DialogHeader className="gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle>Delete {project.name}?</DialogTitle>
                    <DialogDescription className="mt-2 leading-relaxed">
                      This removes the project from Overlord, including chats, todos, marketing content, and settings.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="flex flex-col gap-3 px-5 pb-5">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFolder}
                onChange={(e) => setDeleteFolder(e.target.checked)}
              />
              <span>
                Also delete the folder from disk
                <span className="text-muted-foreground font-mono ml-1">({project.path})</span>
              </span>
            </label>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                To confirm, type the project name: <strong className="text-foreground">{expected}</strong>
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={expected}
                className="h-8 text-xs font-mono"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-b-xl px-5 py-4 sm:pr-5">
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!canDelete || deleting}
              >
                {deleting ? "Deleting..." : deleteFolder ? "Delete project + folder" : "Delete project"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function IndexingCard({ project }: { project: Project }) {
  const [status, setStatus] = useState<{ indexed: boolean; indexing: boolean }>({ indexed: false, indexing: false });
  const [busy, setBusy] = useState<"index" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    fetch(`/api/codegraph/${project.id}/status`)
      .then((res) => res.json())
      .then((data) => {
        setStatus({ indexed: !!data.indexed, indexing: !!data.indexing });
      })
      .catch((err) => setError(String(err)));
  }, [project.id]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!status.indexing) return;
    const interval = window.setInterval(refreshStatus, 3000);
    return () => window.clearInterval(interval);
  }, [refreshStatus, status.indexing]);

  const runAction = useCallback(async (action: "index" | "remove") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/codegraph/${project.id}${action === "index" ? "/init" : ""}`, {
        method: action === "remove" ? "DELETE" : "POST",
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || `HTTP ${res.status}` };
      }
      if (!res.ok || data.error) {
        throw new Error(data.error || "CodeGraph action failed");
      }
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [project.id, refreshStatus]);

  const disabled = status.indexing || busy !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <SearchCode className="h-4 w-4" />
          Indexing
        </CardTitle>
        <CardDescription className="text-xs">
          Configure CodeGraph for this project. When indexed, Claude can use a semantic code graph in Chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              status.indexing ? "bg-amber-400" : status.indexed ? "bg-emerald-400" : "bg-muted-foreground/50"
            }`}
          />
          <span className="font-medium">
            {status.indexing ? "Indexing in progress" : status.indexed ? "CodeGraph indexed" : "CodeGraph not indexed"}
          </span>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => runAction("index")}
            disabled={disabled}
          >
            {busy === "index" || status.indexing ? "Indexing..." : status.indexed ? "Rebuild index" : "Create index"}
          </Button>
          {status.indexed && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => runAction("remove")}
              disabled={disabled}
              className="text-destructive hover:text-destructive"
            >
              {busy === "remove" ? "Removing..." : "Disable CodeGraph"}
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Rebuild the index after large code changes. Overlord keeps Chat focused on conversation and manages indexing here.
        </p>
      </CardContent>
    </Card>
  );
}

function ToolToggle({ tool, label, selected, onToggle }: { tool: string; label?: string; selected: boolean; onToggle: (t: string) => void }) {
  return (
    <button
      onClick={() => onToggle(tool)}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-mono transition-colors ${
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      {label ?? tool}
    </button>
  );
}
