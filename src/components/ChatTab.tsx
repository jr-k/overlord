import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Square, Copy, Check, ArrowDown, Undo2, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolUseCard } from "./ToolUseCard.js";
import { RichPasteInput, type RichPasteInputHandle, type FileBlock } from "./RichPasteInput.js";
import type { Project } from "../types.js";

type AgentStatus = "idle" | "waiting" | "running";
type LearningsStatus = "idle" | "generating";

interface PastedBlock {
  id: string;
  content: string;
  lineCount: number;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  displayContent?: string; // What to show in UI (may differ from content sent to Claude)
  pastedBlocks?: PastedBlock[];
  fileBlocks?: FileBlock[];
  toolName?: string;
  toolInput?: Record<string, any>;
  toolResult?: string;
  snapshotSha?: string;
  eventIndex?: number;
}

interface Props {
  project: Project;
  input: string;
  onInputChange: (value: string) => void;
  activeWorkspaces: string[];
  onToggleWorkspace: (path: string) => void;
  channel?: "chat" | "marketing";
}

// Extract readable chat entries from Claude stream-json events
// `indexOffset` is the absolute position in the full events array (for pagination).
function extractFromEvents(events: any[], indexOffset = 0): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let pendingText = "";

  function flushText() {
    if (pendingText.trim()) {
      entries.push({ id: crypto.randomUUID(), role: "assistant", content: pendingText.trim() });
      pendingText = "";
    }
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "user_message") {
      flushText();
      entries.push({
        id: crypto.randomUUID(),
        role: "user",
        content: ev.content,
        snapshotSha: ev.snapshotSha ?? undefined,
        eventIndex: indexOffset + i,
      });
    } else if (ev.type === "assistant") {
      const blocks = ev.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          pendingText += block.text;
        } else if (block.type === "tool_use") {
          flushText();
          entries.push({
            id: block.id ?? crypto.randomUUID(),
            role: "tool",
            content: block.name,
            toolName: block.name,
            toolInput: block.input,
          });
        } else if (block.type === "tool_result") {
          // Attach result to the last tool entry
          const lastTool = [...entries].reverse().find((e) => e.role === "tool");
          if (lastTool) {
            const text = Array.isArray(block.content)
              ? block.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
              : typeof block.content === "string" ? block.content : "";
            lastTool.toolResult = text;
          }
        }
      }
    } else if (ev.type === "result") {
      if (!pendingText.trim() && ev.result) {
        pendingText = ev.result;
      }
      flushText();
    }
  }

  flushText();
  return entries;
}

function InlineDisplay({ content, blocks, files }: { content: string; blocks: PastedBlock[]; files?: FileBlock[] }) {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const filesById = new Map((files ?? []).map((f) => [f.id, f]));
  type Part = { kind: "text"; text: string } | { kind: "paste"; block: PastedBlock } | { kind: "file"; file: FileBlock };
  const parts: Part[] = [];
  let lastIndex = 0;
  const regex = /\{\{(paste|file):([^}]+)\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ kind: "text", text: content.slice(lastIndex, match.index) });
    if (match[1] === "paste") {
      const block = blocksById.get(match[2]);
      if (block) parts.push({ kind: "paste", block });
      else parts.push({ kind: "text", text: match[0] });
    } else {
      const file = filesById.get(match[2]);
      if (file) parts.push({ kind: "file", file });
      else parts.push({ kind: "text", text: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) parts.push({ kind: "text", text: content.slice(lastIndex) });

  return (
    <div className="whitespace-pre-wrap">
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.text}</span>;
        if (p.kind === "paste") return <PastedBadge key={i} block={p.block} />;
        return <FileBadge key={i} file={p.file} />;
      })}
    </div>
  );
}

function FileBadge({ file }: { file: FileBlock }) {
  const sizeLabel = file.size < 1024
    ? `${file.size} B`
    : file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/20 border border-primary-foreground/30 px-2 py-0.5 text-[11px] font-mono cursor-default"
      title={`${file.path} • ${sizeLabel}`}
    >
      📄 {file.filename} ({sizeLabel})
    </span>
  );
}

function PastedBadge({ block }: { block: PastedBlock }) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <span
      className="relative inline-flex items-center rounded-md bg-primary-foreground/20 border border-primary-foreground/30 px-2 py-0.5 text-[11px] font-mono cursor-default"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      [{block.lineCount} ligne{block.lineCount > 1 ? "s" : ""} copiee{block.lineCount > 1 ? "s" : ""}]
      {showPreview && (
        <div className="absolute bottom-full left-0 mb-1 w-80 max-h-48 overflow-auto rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg z-50 font-mono whitespace-pre-wrap">
          {block.content.slice(0, 2000)}
          {block.content.length > 2000 && "\n..."}
        </div>
      )}
    </span>
  );
}

function AddToTodoButton({ content, projectId }: { content: string; projectId: number }) {
  const [added, setAdded] = useState(false);

  const handleAdd = useCallback(async () => {
    const title = content.slice(0, 100).split("\n")[0];
    const description = content.length > 100 ? content.slice(0, 500) : undefined;
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title, description }),
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }, [content, projectId]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <span
          role="button"
          onClick={handleAdd}
          className="flex h-6 w-6 items-center justify-center rounded-md opacity-0 group-hover/msg:opacity-100 transition-opacity hover:bg-secondary cursor-pointer"
        >
          {added ? (
            <Check className="h-3 w-3 text-green-400" />
          ) : (
            <Plus className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        Ajouter aux todos
      </TooltipContent>
    </Tooltip>
  );
}

const UserMessage = React.memo(function UserMessage({
  entry,
  projectId,
  onRollback,
}: {
  entry: ChatEntry;
  projectId: number;
  onRollback: (content: string) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [confirmNeeded, setConfirmNeeded] = useState<string | null>(null);

  const handleRollback = useCallback(async (force = false) => {
    if (!entry.snapshotSha) return;
    setRolling(true);

    const endpoint = force ? "/api/agent/rollback/force" : "/api/agent/rollback";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        snapshotSha: entry.snapshotSha,
        messageIndex: entry.eventIndex,
      }),
    });
    const data = await res.json();

    if (data.needsConfirm) {
      setConfirmNeeded(data.error);
      setRolling(false);
      return;
    }

    if (data.ok) {
      onRollback(entry.content);
    }
    setRolling(false);
  }, [entry, projectId, onRollback]);

  return (
    <div className="group/user ml-auto max-w-[80%]">
      {/* Confirm dialog */}
      {confirmNeeded && (
        <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{confirmNeeded}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => handleRollback(true)}
              className="rounded bg-destructive px-2 py-1 text-[11px] text-white hover:bg-destructive/80"
            >
              Rollback quand meme
            </button>
            <button
              onClick={() => setConfirmNeeded(null)}
              className="rounded bg-secondary px-2 py-1 text-[11px] hover:bg-secondary/80"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="relative rounded-lg bg-primary px-4 py-3 text-primary-foreground">
        {/* Rollback button */}
        {entry.snapshotSha && (
          <button
            onClick={() => handleRollback()}
            disabled={rolling}
            className="absolute -left-8 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md opacity-0 group-hover/user:opacity-100 transition-opacity hover:bg-secondary"
            title="Rollback: restaurer le code et remettre le message dans l'input"
          >
            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50">
          Toi
        </div>
        <div className="text-sm leading-relaxed select-text">
          {entry.displayContent ? (
            <InlineDisplay content={entry.displayContent} blocks={entry.pastedBlocks ?? []} files={entry.fileBlocks} />
          ) : (entry.pastedBlocks?.length || entry.fileBlocks?.length) ? (
            <div className="flex flex-wrap gap-1.5">
              {entry.pastedBlocks?.map((block) => (
                <PastedBadge key={block.id} block={block} />
              ))}
              {entry.fileBlocks?.map((file) => (
                <FileBadge key={file.id} file={file} />
              ))}
            </div>
          ) : (
            <div className="whitespace-pre-wrap">{entry.content}</div>
          )}
        </div>
      </div>
    </div>
  );
});

const MessageBubble = React.memo(function MessageBubble({ content, projectId }: { content: string; projectId: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <div className="group/msg relative max-w-[90%] rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-50">
          Claude
        </span>
        <div className="flex items-center gap-0.5">
          <AddToTodoButton content={content} projectId={projectId} />
          <Tooltip>
            <TooltipTrigger>
              <span
                role="button"
                onClick={handleCopy}
                className="flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/msg:opacity-100 hover:bg-secondary cursor-pointer"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-400" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Copier le markdown</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="select-text">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
});

export function ChatTab({ project, input, onInputChange, activeWorkspaces, onToggleWorkspace, channel = "chat" }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<RichPasteInputHandle>(null);
  const [connected, setConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [learningsStatus, setLearningsStatus] = useState<LearningsStatus>("idle");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [firstLoadedIndex, setFirstLoadedIndex] = useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Model settings (fetched from project)
  const [model, setModel] = useState<string>("");
  useEffect(() => {
    fetch(`/api/projects/${project.id}`)
      .then((r) => r.json())
      .then((data) => setModel(data.model ?? ""))
      .catch(() => {});
  }, [project.id]);

  const handleModelChange = useCallback(async (newModel: string) => {
    setModel(newModel);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: newModel || null }),
    });
  }, [project.id]);

  // Codegraph status (chat channel only)
  const [codegraphStatus, setCodegraphStatus] = useState<{ indexed: boolean; indexing: boolean }>({ indexed: false, indexing: false });
  const fetchCodegraphStatus = useCallback(() => {
    if (channel !== "chat") return;
    fetch(`/api/codegraph/${project.id}/status`)
      .then((r) => r.json())
      .then((data) => setCodegraphStatus({ indexed: !!data.indexed, indexing: !!data.indexing }))
      .catch(() => {});
  }, [project.id, channel]);

  useEffect(() => {
    fetchCodegraphStatus();
    // Poll while indexing
    const interval = setInterval(() => {
      if (codegraphStatus.indexing) fetchCodegraphStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchCodegraphStatus, codegraphStatus.indexing]);

  const handleIndexCodegraph = useCallback(async () => {
    setCodegraphStatus((s) => ({ ...s, indexing: true }));
    await fetch(`/api/codegraph/${project.id}/init`, { method: "POST" });
    fetchCodegraphStatus();
  }, [project.id, fetchCodegraphStatus]);

  // Fetch workspace packages for the workspace selector
  const [workspacePackages, setWorkspacePackages] = useState<{ name: string; path: string; category: string }[]>([]);
  useEffect(() => {
    fetch(`/api/projects/${project.id}/workspaces`)
      .then((r) => r.json())
      .then((data) => {
        console.log("[chat] workspaces:", data?.packages?.length ?? 0);
        if (data.packages?.length) {
          setWorkspacePackages(data.packages.map((p: any) => ({ name: p.name, path: p.path, category: p.category })));
        } else {
          setWorkspacePackages([]);
        }
      })
      .catch((err) => { console.log("[chat] workspaces error:", err); setWorkspacePackages([]); });
  }, [project.id]);

  // Token usage tracking
  const [tokenStats, setTokenStats] = useState({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    turns: 0,
  });

  // RTK savings
  const [rtkSavings, setRtkSavings] = useState<{
    total_commands: number;
    total_input: number;
    total_output: number;
    total_saved: number;
    avg_savings_pct: number;
  } | null>(null);

  // Codegraph usage estimate — heuristic tokens saved per tool call (arbitrary, tweakable).
  // Each value = rough tokens a Read+Grep equivalent would have consumed.
  const codegraphSavingsPerCall: Record<string, number> = {
    mcp__codegraph__codegraph_context: 8000,
    mcp__codegraph__codegraph_search: 3000,
    mcp__codegraph__codegraph_callers: 5000,
    mcp__codegraph__codegraph_callees: 5000,
    mcp__codegraph__codegraph_impact: 6000,
    mcp__codegraph__codegraph_explore: 4000,
    mcp__codegraph__codegraph_node: 1500,
    mcp__codegraph__codegraph_files: 500,
    mcp__codegraph__codegraph_status: 100,
  };

  const codegraphStats = useMemo(() => {
    const perTool: Record<string, { calls: number; consumed: number; saved: number }> = {};
    let totalCalls = 0;
    let totalConsumed = 0;
    let totalSaved = 0;
    for (const e of entries) {
      if (e.role !== "tool" || !e.toolName) continue;
      if (!e.toolName.startsWith("mcp__codegraph__")) continue;
      const consumed = Math.ceil((e.toolResult?.length ?? 0) / 4);
      const saved = codegraphSavingsPerCall[e.toolName] ?? 0;
      perTool[e.toolName] ??= { calls: 0, consumed: 0, saved: 0 };
      perTool[e.toolName].calls += 1;
      perTool[e.toolName].consumed += consumed;
      perTool[e.toolName].saved += saved;
      totalCalls += 1;
      totalConsumed += consumed;
      totalSaved += saved;
    }
    return { perTool, totalCalls, totalConsumed, totalSaved };
  }, [entries]);

  // Message queue — messages typed while agent is working
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  // Pasted content — stored separately, shown as badges
  const [pastedBlocks, setPastedBlocks] = useState<{ id: string; content: string; lineCount: number }[]>([]);
  const [fileBlocks, setFileBlocks] = useState<FileBlock[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialScrollDone = useRef(false);
  const userScrolledUp = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Track current tool being used (for streaming tool input)
  const currentToolRef = useRef<{ id: string; name: string; inputJson: string } | null>(null);
  // Track event index to deduplicate events after subscribe
  const lastEventIndexRef = useRef(0);

  // Slash commands
  const BUILTIN_COMMANDS = [
    "clear", "help", "cost", "compact", "context",
    "init", "release-notes", "review", "security-review",
  ];
  const [slashCommands, setSlashCommands] = useState<string[]>(BUILTIN_COMMANDS);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  const showSlash = input.startsWith("/") && agentStatus === "idle" && !slashDismissed;
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  const filteredCommands = useMemo(() => {
    if (!showSlash) return [];
    return slashCommands.filter((cmd) => cmd.toLowerCase().includes(slashQuery));
  }, [showSlash, slashCommands, slashQuery]);

  useEffect(() => {
    if (!input.startsWith("/")) setSlashDismissed(false);
    setSlashIndex(0);
  }, [input]);

  // Fetch RTK savings when turns change
  useEffect(() => {
    if (tokenStats.turns === 0) return;
    fetch(`/api/rtk/gain/${project.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.summary) setRtkSavings(data.summary);
      })
      .catch(() => {});
  }, [tokenStats.turns, project.id]);

  // Timer
  useEffect(() => {
    if (agentStatus === "waiting" || agentStatus === "running") {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [agentStatus]);

  // Auto-scroll only if user hasn't scrolled up
  useEffect(() => {
    if (!scrollRef.current) return;
    if (!initialScrollDone.current && entries.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      initialScrollDone.current = true;
    } else if (!userScrolledUp.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [entries, streamingText]);

  const loadOlderRef = useRef<() => void>(() => {});

  // Detect user scroll position + auto-load older when near top
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    userScrolledUp.current = !atBottom;
    setShowScrollBtn(!atBottom);
    if (scrollTop < 200) loadOlderRef.current();
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    userScrolledUp.current = false;
    setShowScrollBtn(false);
  }, []);

  const loadOlder = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (firstLoadedIndex <= 0 || loadingOlder) return;
    setLoadingOlder(true);
    ws.send(JSON.stringify({
      type: "loadOlder",
      projectId: project.id,
      channel,
      beforeIndex: firstLoadedIndex,
      limit: 500,
    }));
  }, [firstLoadedIndex, loadingOlder, project.id, channel]);

  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);

  // WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: "subscribe",
          projectId: project.id,
          projectPath: project.path,
          channel,
        })
      );
    };

    ws.onclose = () => {
      setConnected(false);
      setAgentStatus("idle");
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "agent:history") {
        const offset = msg.firstLoadedIndex ?? 0;
        const parsed = extractFromEvents(msg.events, offset);
        setEntries(parsed);
        setFirstLoadedIndex(offset);
        setTotalEvents(msg.totalEvents ?? msg.eventCount ?? msg.events.length);
        setStreamingText("");
        lastEventIndexRef.current = msg.eventCount ?? msg.events.length;

        // Rebuild token stats from history
        let stats = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0, turns: 0 };
        for (const ev of msg.events) {
          if (ev.type === "system" && ev.subtype === "init" && ev.slash_commands) {
            setSlashCommands((prev) => [...new Set([...BUILTIN_COMMANDS, ...ev.slash_commands])]);
          }
          if (ev.type === "result" && ev.usage) {
            stats.inputTokens += ev.usage.input_tokens ?? 0;
            stats.outputTokens += ev.usage.output_tokens ?? 0;
            stats.cacheReadTokens += ev.usage.cache_read_input_tokens ?? 0;
            stats.cacheWriteTokens += ev.usage.cache_creation_input_tokens ?? 0;
            stats.totalCost += ev.total_cost_usd ?? 0;
            stats.turns += 1;
          }
        }
        setTokenStats(stats);

        if (msg.status === "running") setAgentStatus("running");
        else setAgentStatus("idle");
      } else if (msg.type === "agent:older") {
        const offset = msg.firstLoadedIndex ?? 0;
        const olderEntries = extractFromEvents(msg.events, offset);
        const scrollEl = scrollRef.current;
        const prevScrollHeight = scrollEl?.scrollHeight ?? 0;
        const prevScrollTop = scrollEl?.scrollTop ?? 0;
        setEntries((prev) => [...olderEntries, ...prev]);
        setFirstLoadedIndex(offset);
        setLoadingOlder(false);
        // Preserve scroll position so the user stays at the same content
        requestAnimationFrame(() => {
          if (scrollEl) {
            const delta = scrollEl.scrollHeight - prevScrollHeight;
            scrollEl.scrollTop = prevScrollTop + delta;
          }
        });
      } else if (msg.type === "agent:ready") {
        setAgentStatus("idle");
      } else if (msg.type === "agent:start") {
        setAgentStatus("waiting");
        setStreamingText("");
      } else if (msg.type === "agent:snapshot") {
        // Patch the last user message with the snapshot SHA
        setEntries((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "user" && updated[i].content === msg.message) {
              updated[i] = { ...updated[i], snapshotSha: msg.snapshotSha, eventIndex: msg.eventIndex };
              break;
            }
          }
          return updated;
        });
      } else if (msg.type === "agent:running") {
        setAgentStatus("running");
      } else if (msg.type === "agent:event") {
        // Skip events already included in the history replay
        if (msg.eventIndex && msg.eventIndex <= lastEventIndexRef.current) return;
        lastEventIndexRef.current = msg.eventIndex ?? lastEventIndexRef.current;
        if (typeof msg.eventIndex === "number") setTotalEvents(msg.eventIndex);

        const ev = msg.event;

        if (ev.type === "system" && ev.subtype === "init" && ev.slash_commands) {
          setSlashCommands((prev) => [...new Set([...BUILTIN_COMMANDS, ...ev.slash_commands])]);
        }

        if (ev.type === "stream_event") {
          const inner = ev.event;

          // Text streaming
          if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
            setStreamingText((prev) => prev + inner.delta.text);
            setAgentStatus("running");
          }

          // Tool use start — flush text, begin tracking tool
          if (inner?.type === "content_block_start" && inner.content_block?.type === "tool_use") {
            // Flush pending text
            setStreamingText((prev) => {
              if (prev.trim()) {
                setEntries((e) => [
                  ...e,
                  { id: crypto.randomUUID(), role: "assistant", content: prev.trim() },
                ]);
              }
              return "";
            });
            currentToolRef.current = {
              id: inner.content_block.id,
              name: inner.content_block.name,
              inputJson: "",
            };
          }

          // Tool input streaming (JSON deltas)
          if (inner?.type === "content_block_delta" && inner.delta?.type === "input_json_delta" && currentToolRef.current) {
            currentToolRef.current.inputJson += inner.delta.partial_json;
          }

          // Tool use end — parse input and add entry
          if (inner?.type === "content_block_stop" && currentToolRef.current) {
            const tool = currentToolRef.current;
            currentToolRef.current = null;

            let toolInput: Record<string, any> = {};
            try {
              toolInput = JSON.parse(tool.inputJson);
            } catch {}

            setEntries((prev) => [
              ...prev,
              {
                id: tool.id,
                role: "tool",
                content: tool.name,
                toolName: tool.name,
                toolInput,
              },
            ]);
            setAgentStatus("running");

            // If agent called AskUserQuestion, pause it: kill the process and wait for user
            if (tool.name === "AskUserQuestion" && toolInput?.questions?.length > 0) {
              console.log("[chat] AskUserQuestion detected, pausing agent");
              wsRef.current?.send(JSON.stringify({ type: "stop", projectId: project.id, channel }));
            }
          }
        } else if (ev.type === "assistant") {
          // Complete assistant message — might contain tool_result
          const blocks = ev.message?.content ?? [];
          for (const block of blocks) {
            if (block.type === "tool_result") {
              const text = Array.isArray(block.content)
                ? block.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
                : typeof block.content === "string" ? block.content : "";
              // Attach to last tool entry with matching ID
              setEntries((prev) => {
                const updated = [...prev];
                const idx = updated.map((e, i) => e.role === "tool" && e.id === block.tool_use_id ? i : -1).filter(i => i >= 0).pop() ?? -1;
                if (idx >= 0) {
                  updated[idx] = { ...updated[idx], toolResult: text };
                }
                return updated;
              });
            }
          }
          setAgentStatus("running");
        } else if (ev.type === "result") {
          setStreamingText((prev) => {
            const text = prev.trim() || (ev.result ?? "").trim();
            if (text) {
              setEntries((e) => [
                ...e,
                { id: crypto.randomUUID(), role: "assistant", content: text },
              ]);
            }
            return "";
          });

          // Capture token stats
          if (ev.usage) {
            setTokenStats((prev) => ({
              inputTokens: prev.inputTokens + (ev.usage.input_tokens ?? 0),
              outputTokens: prev.outputTokens + (ev.usage.output_tokens ?? 0),
              cacheReadTokens: prev.cacheReadTokens + (ev.usage.cache_read_input_tokens ?? 0),
              cacheWriteTokens: prev.cacheWriteTokens + (ev.usage.cache_creation_input_tokens ?? 0),
              totalCost: prev.totalCost + (ev.total_cost_usd ?? 0),
              turns: prev.turns + 1,
            }));
          }
        }
      } else if (msg.type === "agent:done") {
        setStreamingText((prev) => {
          if (prev.trim()) {
            setEntries((e) => [
              ...e,
              { id: crypto.randomUUID(), role: "assistant", content: prev.trim() },
            ]);
          }
          return "";
        });

        // Desktop notification
        if (document.hidden && Notification.permission === "granted") {
          new Notification(`Overlord — ${project.name}`, {
            body: "Claude a termine son travail.",
            icon: "/favicon.ico",
          });
        }

        // Process message queue — send next queued message
        setMessageQueue((queue) => {
          if (queue.length > 0 && ws.readyState === WebSocket.OPEN) {
            const [next, ...rest] = queue;
            // Send after a small delay so state settles
            setTimeout(() => {
              setAgentStatus("waiting");
              setEntries((prev) => [
                ...prev,
                { id: crypto.randomUUID(), role: "user", content: next },
              ]);
              ws.send(
                JSON.stringify({
                  type: "chat",
                  projectId: project.id,
                  projectPath: project.path,
                  message: next,
                  channel,
                })
              );
            }, 500);
            return rest;
          }
          setAgentStatus("idle");
          return queue;
        });
      } else if (msg.type === "learnings:generating" && msg.projectId === project.id) {
        setLearningsStatus("generating");
      } else if (msg.type === "learnings:done" && msg.projectId === project.id) {
        setLearningsStatus("idle");
      }
    };

    return () => ws.close();
  }, [project.id, project.path, channel]);

  const handleSend = useCallback(() => {
    const currentBlocks = [...pastedBlocks];
    const currentFiles = [...fileBlocks];
    const typedText = input;

    // Replace {{paste:id}} placeholders with actual content at their position
    const blocksById = new Map(currentBlocks.map((b) => [b.id, b]));
    const filesById = new Map(currentFiles.map((f) => [f.id, f]));
    let rawMessage = typedText
      .replace(/\{\{paste:([^}]+)\}\}/g, (_, id) => {
        const block = blocksById.get(id);
        return block ? `\n${block.content}\n` : "";
      })
      .replace(/\{\{file:([^}]+)\}\}/g, (_, id) => {
        const file = filesById.get(id);
        return file ? `[Joined file at ${file.path}]` : "";
      })
      .trim();

    // If there are leftover blocks never referenced (shouldn't happen normally), append them
    const usedIds = new Set<string>();
    typedText.replace(/\{\{paste:([^}]+)\}\}/g, (_, id) => { usedIds.add(id); return ""; });
    const unusedBlocks = currentBlocks.filter((b) => !usedIds.has(b.id));
    if (unusedBlocks.length > 0) {
      rawMessage = [rawMessage, ...unusedBlocks.map((b) => b.content)].filter(Boolean).join("\n\n");
    }

    const usedFileIds = new Set<string>();
    typedText.replace(/\{\{file:([^}]+)\}\}/g, (_, id) => { usedFileIds.add(id); return ""; });
    const unusedFiles = currentFiles.filter((f) => !usedFileIds.has(f.id));
    if (unusedFiles.length > 0) {
      rawMessage = [rawMessage, ...unusedFiles.map((f) => `[Joined file at ${f.path}]`)].filter(Boolean).join("\n\n");
    }

    if (!rawMessage || !wsRef.current) return;

    // Inject workspace scope if workspaces are selected
    let fullMessage = rawMessage;
    if (activeWorkspaces.length > 0) {
      const scope = activeWorkspaces.join(", ");
      fullMessage = `[Scope: focus on ${scope} in this monorepo]\n\n${rawMessage}`;
    }

    setSlashDismissed(true);
    onInputChange("");
    setPastedBlocks([]);
    setFileBlocks([]);

    // Request notification permission on first interaction
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    // If agent is working, queue the message
    if (agentStatus !== "idle") {
      setMessageQueue((prev) => [...prev, fullMessage]);
      return;
    }

    setAgentStatus("waiting");
    setEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: fullMessage,
        displayContent: typedText.trim() || undefined,
        pastedBlocks: currentBlocks.length > 0 ? currentBlocks : undefined,
        fileBlocks: currentFiles.length > 0 ? currentFiles : undefined,
      },
    ]);

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        projectId: project.id,
        projectPath: project.path,
        message: fullMessage,
        channel,
      })
    );
  }, [input, pastedBlocks, fileBlocks, project, onInputChange, agentStatus, channel, activeWorkspaces]);

  const handleAnswerQuestions = useCallback((answer: string) => {
    if (!wsRef.current) return;

    setAgentStatus("waiting");
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: answer },
    ]);

    if (agentStatus !== "idle") {
      setMessageQueue((prev) => [...prev, answer]);
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        projectId: project.id,
        projectPath: project.path,
        message: answer,
        channel,
      })
    );
  }, [project, agentStatus, channel]);

  const handleStop = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({ type: "stop", projectId: project.id, channel })
    );
  }, [project.id, channel]);

  const selectSlashCommand = useCallback(
    (cmd: string) => {
      onInputChange(`/${cmd} `);
      setSlashDismissed(true);
      textareaRef.current?.focus();
    },
    [onInputChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlash && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashCommand(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;

  const formatTokens = (n: number) =>
    n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` :
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` :
    String(n);

  const isWorking = agentStatus === "waiting" || agentStatus === "running";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm text-primary">
            claude @ {project.name}
          </span>
          {learningsStatus === "generating" && (
            <Badge
              variant="outline"
              className="gap-1.5 text-[10px] border-purple-400/40 text-purple-400 animate-pulse"
              title="L'agent analyse cette session pour en tirer des apprentissages"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400" />
              Analyse de la session...
            </Badge>
          )}
          {channel === "chat" && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 text-[10px]",
                codegraphStatus.indexing && "border-amber-400/40 text-amber-400 animate-pulse",
                !codegraphStatus.indexing && codegraphStatus.indexed && "border-emerald-400/40 text-emerald-400",
                !codegraphStatus.indexing && !codegraphStatus.indexed && "border-zinc-400/40 text-zinc-400"
              )}
              title={
                codegraphStatus.indexing
                  ? "CodeGraph est en train d'indexer le projet"
                  : codegraphStatus.indexed
                    ? "CodeGraph indexed — Claude utilise un index sémantique pour explorer le code"
                    : "CodeGraph non indexé — clique sur 'Indexer' pour activer"
              }
            >
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                codegraphStatus.indexing && "bg-amber-400",
                !codegraphStatus.indexing && codegraphStatus.indexed && "bg-emerald-400",
                !codegraphStatus.indexing && !codegraphStatus.indexed && "bg-zinc-400"
              )} />
              {codegraphStatus.indexing ? "Indexation..." : codegraphStatus.indexed ? "Indexed" : "Not indexed"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            className="hidden md:block rounded border border-border bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer font-mono"
            title="Claude model for this project"
            disabled={isWorking}
          >
            <option value="">Default</option>
            <option value="claude-opus-4-7">Opus 4.7</option>
            <option value="claude-opus-4-6[1m]">Opus 4.6 (1M)</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-sonnet-4-6[1m]">Sonnet 4.6 (1M)</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          </select>
          {tokenStats.turns > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground font-mono cursor-help">
                  <span>{formatTokens(tokenStats.inputTokens)} in</span>
                  <span>{formatTokens(tokenStats.outputTokens)} out</span>
                  {tokenStats.cacheReadTokens > 0 && (
                    <span className="text-green-400/70">
                      {formatTokens(tokenStats.cacheReadTokens)} cache
                    </span>
                  )}
                  <span className="text-primary/70">
                    ${tokenStats.totalCost.toFixed(4)}
                  </span>
                  {rtkSavings && rtkSavings.total_saved > 0 && rtkSavings.avg_savings_pct < 100 && (
                    <span className="text-emerald-400 font-semibold">
                      RTK -{Math.round(rtkSavings.avg_savings_pct)}%
                    </span>
                  )}
                  {codegraphStatus.indexed && (
                    <span className={cn(
                      "font-semibold",
                      codegraphStats.totalCalls > 0 ? "text-cyan-400" : "text-muted-foreground/60"
                    )}>
                      CG {codegraphStats.totalCalls}×{codegraphStats.totalCalls > 0 ? ` ~${formatTokens(codegraphStats.totalSaved)}` : ""}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                <div className="space-y-1.5 font-sans">
                  <p><strong>{formatTokens(tokenStats.inputTokens)} in</strong> — tokens envoyes a Claude (votre message + contexte projet)</p>
                  <p><strong>{formatTokens(tokenStats.outputTokens)} out</strong> — tokens generes par Claude (sa reponse)</p>
                  {tokenStats.cacheReadTokens > 0 && (
                    <p><strong className="text-green-400">{formatTokens(tokenStats.cacheReadTokens)} cache</strong> — tokens lus depuis le cache au lieu d'etre re-traites (economie de cout)</p>
                  )}
                  <p><strong className="text-primary">${tokenStats.totalCost.toFixed(4)}</strong> — cout API cumule de cette session ({tokenStats.turns} echange{tokenStats.turns > 1 ? "s" : ""})</p>
                  {rtkSavings && rtkSavings.total_saved > 0 && rtkSavings.avg_savings_pct < 100 && (
                    <p><strong className="text-emerald-400">RTK -{Math.round(rtkSavings.avg_savings_pct)}%</strong> — tokens economises par RTK sur {rtkSavings.total_commands} commandes shell (compresse git status, ls, etc.)</p>
                  )}
                  {codegraphStatus.indexed && (
                    <div className="border-t border-border/50 pt-1.5 mt-1.5">
                      <p><strong className="text-cyan-400">Codegraph</strong> — {codegraphStats.totalCalls} appel{codegraphStats.totalCalls > 1 ? "s" : ""}</p>
                      {codegraphStats.totalCalls > 0 ? (
                        <>
                          <p className="text-muted-foreground">Consomme: <strong>{formatTokens(codegraphStats.totalConsumed)}</strong> tokens (resultats lus par Claude)</p>
                          <p className="text-muted-foreground">Estime epargne: <strong className="text-cyan-400">~{formatTokens(codegraphStats.totalSaved)}</strong> tokens vs Read/Grep equivalents</p>
                          <p className="text-[10px] italic opacity-60 mt-1">Heuristique arbitraire (8k/context, 5k/callers, 3k/search, 0.5k/files). Ratio epargne/consomme = {codegraphStats.totalConsumed > 0 ? (codegraphStats.totalSaved / codegraphStats.totalConsumed).toFixed(1) : "—"}x.</p>
                          <div className="mt-1 space-y-0.5">
                            {Object.entries(codegraphStats.perTool).map(([tool, s]) => (
                              <p key={tool} className="text-[10px] text-muted-foreground font-mono">
                                {tool.replace("mcp__codegraph__codegraph_", "")}: {s.calls}× — {formatTokens(s.consumed)} in / ~{formatTokens(s.saved)} saved
                              </p>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-[10px] italic opacity-60 mt-1">
                          MCP active mais Claude ne l'a pas appele. Mentionne-le dans ton message ("utilise codegraph...") ou ajoute une nudge dans le system prompt projet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <span
            className={cn(
              "text-xs",
              connected ? "text-green-400" : "text-red-400"
            )}
          >
            {connected ? "connecte" : "deconnecte"}
          </span>
        </div>
      </div>

      {/* Status bar */}
      {isWorking && (
        <div
          className={cn(
            "flex items-center gap-3 overflow-hidden border-b px-5 py-2 text-xs",
            agentStatus === "waiting"
              ? "border-yellow-400/20 bg-yellow-400/5 text-yellow-400"
              : "border-green-400/20 bg-green-400/5 text-green-400"
          )}
        >
          {agentStatus === "waiting"
            ? `Claude demarre... (${formatElapsed(elapsed)})`
            : `Claude travaille... (${formatElapsed(elapsed)})`}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 min-h-0 overflow-y-auto p-4 space-y-3 scrollbar-visible select-text">
        {firstLoadedIndex > 0 && (
          <div className="flex justify-center pt-1 pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs text-muted-foreground"
            >
              {loadingOlder ? "Chargement..." : `Charger les messages precedents (${firstLoadedIndex} restants)`}
            </Button>
          </div>
        )}
        {entries.length === 0 && !streamingText && agentStatus === "idle" && (
          <p className="text-center text-sm text-muted-foreground py-12">
            Demarrer une conversation avec Claude sur{" "}
            <strong className="text-foreground">{project.name}</strong>
            <br />
            <span className="text-xs mt-1 inline-block">
              Tape <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-mono">/</kbd> pour les commandes
            </span>
          </p>
        )}

        {entries.map((entry) =>
          entry.role === "tool" ? (
            <ToolUseCard
              key={entry.id}
              name={entry.toolName ?? entry.content}
              input={entry.toolInput}
              result={entry.toolResult}
              onAnswerQuestions={handleAnswerQuestions}
            />
          ) : entry.role === "user" ? (
            <UserMessage
              key={entry.id}
              entry={entry}
              projectId={project.id}
              onRollback={(content) => {
                onInputChange(content);
                // Remove this message and everything after from entries
                setEntries((prev) => {
                  const idx = prev.findIndex((e) => e.id === entry.id);
                  return idx >= 0 ? prev.slice(0, idx) : prev;
                });
              }}
            />
          ) : (
            <MessageBubble key={entry.id} content={entry.content} projectId={project.id} />
          )
        )}

        {streamingText && (
          <div className="group/msg relative max-w-[90%] rounded-lg border border-border bg-card px-4 py-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50">
              Claude
            </div>
            <div className="select-text">
              <MarkdownContent content={streamingText} />
            </div>
            <span className="inline-block h-4 w-0.5 animate-pulse bg-primary ml-0.5" />
          </div>
        )}

        {/* Typing indicator when agent is working but no text yet */}
        {isWorking && !streamingText && (
          <div className="max-w-[90%] rounded-lg border border-border bg-card px-4 py-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50">
              Claude
            </div>
            <div className="flex items-center gap-1 py-1">
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" />
              <span className="ml-2 text-[11px] text-muted-foreground">
                {agentStatus === "waiting" ? `Démarrage... ${formatElapsed(elapsed)}` : `${formatElapsed(elapsed)}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <div className="flex justify-center -mt-10 relative z-10 pointer-events-none">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 rounded-full px-3 text-xs shadow-lg pointer-events-auto border border-border"
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-3 w-3" />
            Dernier message
          </Button>
        </div>
      )}

      {/* Workspace scope selector */}
      {workspacePackages.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-border px-5 py-1.5 overflow-x-auto scrollbar-visible">
          <span className="text-[10px] text-muted-foreground shrink-0 mr-1">Scope:</span>
          {workspacePackages.map((pkg) => (
            <button
              key={pkg.path}
              onClick={() => onToggleWorkspace(pkg.path)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono transition-colors shrink-0",
                activeWorkspaces.includes(pkg.path)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {pkg.name}
            </button>
          ))}
          {activeWorkspaces.length > 0 && (
            <button
              onClick={() => activeWorkspaces.forEach((p) => onToggleWorkspace(p))}
              className="text-[10px] text-muted-foreground hover:text-foreground ml-1 shrink-0"
            >
              reset
            </button>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="relative border-t border-border bg-card p-4">
        {showSlash && filteredCommands.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg scrollbar-visible">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                  i === slashIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSlashCommand(cmd);
                }}
                onMouseEnter={() => setSlashIndex(i)}
              >
                <span className="font-mono text-xs text-primary">/</span>
                <span>{cmd}</span>
              </button>
            ))}
          </div>
        )}

        {/* CodeGraph index suggestion */}
        {channel === "chat" && !codegraphStatus.indexed && !codegraphStatus.indexing && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-emerald-400 font-medium">Activer CodeGraph</span>
              <span className="text-muted-foreground text-[10px]">
                Index sémantique du code, -94% de tool calls pour Claude
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 shrink-0"
              onClick={handleIndexCodegraph}
            >
              Indexer
            </Button>
          </div>
        )}

        {/* Queued messages indicator */}
        {messageQueue.length > 0 && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/20 px-1.5 text-[10px] font-bold text-primary">
              {messageQueue.length}
            </span>
            <span>message{messageQueue.length > 1 ? "s" : ""} en attente</span>
            <button
              onClick={() => setMessageQueue([])}
              className="ml-auto text-[10px] text-muted-foreground hover:text-destructive"
            >
              Vider la file
            </button>
          </div>
        )}

        <div
          className="flex items-stretch gap-2"
          style={{ minHeight: "12vh", maxHeight: "20vh" }}
        >
          <RichPasteInput
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={handleKeyDown}
            blocks={pastedBlocks}
            onPasteBlock={(block) => setPastedBlocks((prev) => [...prev, block])}
            onRemoveBlock={(id) => setPastedBlocks((prev) => prev.filter((b) => b.id !== id))}
            fileBlocks={fileBlocks}
            onFileSelect={async (file) => {
              const fd = new FormData();
              fd.append("file", file);
              fd.append("projectId", String(project.id));
              try {
                const res = await fetch("/api/uploads", { method: "POST", body: fd });
                if (!res.ok) return null;
                const data = await res.json();
                const block: FileBlock = {
                  id: data.id,
                  filename: data.filename,
                  path: data.path,
                  size: data.size,
                  mimeType: data.mimeType,
                };
                setFileBlocks((prev) => [...prev, block]);
                return block;
              } catch {
                return null;
              }
            }}
            onRemoveFileBlock={(id) => {
              setFileBlocks((prev) => prev.filter((f) => f.id !== id));
              fetch(`/api/uploads/${id}?projectId=${project.id}`, { method: "DELETE" }).catch(() => {});
            }}
            placeholder={
              isWorking
                ? `Taper un message (sera envoye quand Claude aura fini)...`
                : `Message ou / pour les commandes...`
            }
            disabled={!connected}
            className={cn(isWorking ? "border-yellow-400/30" : "border-border")}
          />
          <div className="flex flex-col justify-end gap-1.5">
            {isWorking && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={handleStop}
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            )}
            <Button
              onClick={handleSend}
              disabled={!connected || (!input.trim() && pastedBlocks.length === 0 && fileBlocks.length === 0)}
              variant={isWorking ? "secondary" : "default"}
            >
              {isWorking ? `En file (${messageQueue.length + 1})` : "Envoyer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
