import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Square } from "lucide-react";
import type { Project } from "../types.js";

type AgentStatus = "idle" | "waiting" | "running";

interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
}

interface Props {
  project: Project;
  input: string;
  onInputChange: (value: string) => void;
}

function extractFromEvents(events: any[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let pendingText = "";

  function flushText() {
    if (pendingText.trim()) {
      entries.push({ id: crypto.randomUUID(), role: "assistant", content: pendingText.trim() });
      pendingText = "";
    }
  }

  for (const ev of events) {
    if (ev.type === "user_message") {
      flushText();
      entries.push({ id: crypto.randomUUID(), role: "user", content: ev.content });
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
            content: `Tool: ${block.name}`,
          });
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

export function ChatTab({ project, input, onInputChange }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [connected, setConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialScrollDone = useRef(false);

  // Slash commands — defaults until we get the real list from Claude's init event
  // Built-in CLI commands that don't appear in Claude's slash_commands list
  const BUILTIN_COMMANDS = [
    "clear", "help", "cost", "compact", "context",
    "init", "release-notes", "review", "security-review",
  ];
  const [slashCommands, setSlashCommands] = useState<string[]>(BUILTIN_COMMANDS);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  // Derived: show slash menu when input starts with / and not dismissed
  const showSlash = input.startsWith("/") && agentStatus === "idle" && !slashDismissed;
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  const filteredCommands = useMemo(() => {
    if (!showSlash) return [];
    return slashCommands.filter((cmd) => cmd.toLowerCase().includes(slashQuery));
  }, [showSlash, slashCommands, slashQuery]);

  // Reset dismiss when input changes away from /
  useEffect(() => {
    if (!input.startsWith("/")) {
      setSlashDismissed(false);
    }
    setSlashIndex(0);
  }, [input]);

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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      if (!initialScrollDone.current && entries.length > 0) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        initialScrollDone.current = true;
      } else {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }
    }
  }, [entries, streamingText]);

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
        const parsed = extractFromEvents(msg.events).slice(-50);
        setEntries(parsed);
        setStreamingText("");
        // Extract slash commands from init events
        for (const ev of msg.events) {
          if (ev.type === "system" && ev.subtype === "init" && ev.slash_commands) {
            setSlashCommands((prev) => [...new Set([...BUILTIN_COMMANDS, ...ev.slash_commands])]);
          }
        }
        if (msg.status === "running") setAgentStatus("running");
        else setAgentStatus("idle");
      } else if (msg.type === "agent:ready") {
        setAgentStatus("idle");
      } else if (msg.type === "agent:start") {
        setAgentStatus("waiting");
        setStreamingText("");
      } else if (msg.type === "agent:running") {
        setAgentStatus("running");
      } else if (msg.type === "agent:event") {
        const ev = msg.event;

        // Capture slash commands from init event
        if (ev.type === "system" && ev.subtype === "init" && ev.slash_commands) {
          setSlashCommands((prev) => [...new Set([...BUILTIN_COMMANDS, ...ev.slash_commands])]);
        }

        if (ev.type === "stream_event") {
          const inner = ev.event;
          if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta") {
            setStreamingText((prev) => prev + inner.delta.text);
            setAgentStatus("running");
          } else if (inner?.type === "content_block_start" && inner.content_block?.type === "tool_use") {
            setStreamingText((prev) => {
              if (prev.trim()) {
                setEntries((e) => [
                  ...e,
                  { id: crypto.randomUUID(), role: "assistant", content: prev.trim() },
                ]);
              }
              return "";
            });
            setEntries((e) => [
              ...e,
              {
                id: inner.content_block.id ?? crypto.randomUUID(),
                role: "tool",
                content: `Tool: ${inner.content_block.name}`,
              },
            ]);
          }
        } else if (ev.type === "assistant") {
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
        setAgentStatus("idle");
      }
    };

    return () => ws.close();
  }, [project.id, project.path]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !wsRef.current) return;
    const msg = input.trim();

    setAgentStatus("waiting");
    setSlashDismissed(true);
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: msg },
    ]);

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        projectId: project.id,
        projectPath: project.path,
        message: msg,
      })
    );

    onInputChange("");
  }, [input, project, onInputChange]);

  const handleStop = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send(
      JSON.stringify({ type: "stop", projectId: project.id })
    );
  }, [project.id]);

  const selectSlashCommand = useCallback(
    (cmd: string) => {
      onInputChange(`/${cmd} `);
      setSlashDismissed(true);
      textareaRef.current?.focus();
    },
    [onInputChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash menu navigation
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

  const isWorking = agentStatus === "waiting" || agentStatus === "running";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-sm text-primary">
          claude @ {project.name}
        </span>
        <div className="flex items-center gap-3">
          {isWorking && (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 gap-1.5 px-2 text-[11px]"
              onClick={handleStop}
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          {agentStatus !== "idle" && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 text-[11px]",
                agentStatus === "waiting" &&
                  "animate-pulse border-yellow-400/40 text-yellow-400",
                agentStatus === "running" &&
                  "animate-pulse border-green-400/40 text-green-400"
              )}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  agentStatus === "waiting" && "bg-yellow-400",
                  agentStatus === "running" && "bg-green-400"
                )}
              />
              {agentStatus === "waiting" && `Demarrage ${formatElapsed(elapsed)}`}
              {agentStatus === "running" && `En cours ${formatElapsed(elapsed)}`}
            </Badge>
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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-visible">
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

        {entries.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "max-w-[85%] rounded-lg px-4 py-3",
              entry.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : entry.role === "tool"
                  ? "bg-secondary border border-border text-muted-foreground text-xs font-mono"
                  : "bg-card border border-border"
            )}
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
              {entry.role === "user" ? "Toi" : entry.role === "tool" ? "Outil" : "Claude"}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {entry.content}
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="max-w-[85%] rounded-lg border border-border bg-card px-4 py-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
              Claude
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {streamingText}
              <span className="inline-block h-4 w-0.5 animate-pulse bg-primary ml-0.5" />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="relative border-t border-border bg-card p-4">
        {/* Slash command autocomplete */}
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

        <div
          className="flex items-stretch gap-2"
          style={{ minHeight: "12vh", maxHeight: "20vh" }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              agentStatus === "idle"
                ? `Message ou / pour les commandes...`
                : "Continuer la conversation..."
            }
            disabled={!connected || isWorking}
            className="h-full flex-1 resize-none rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={handleSend}
            disabled={!connected || !input.trim() || isWorking}
            className="self-end"
          >
            {isWorking ? "..." : "Envoyer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
