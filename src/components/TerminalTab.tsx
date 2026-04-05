import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import type { Project } from "../types.js";

interface TerminalInstance {
  id: string;
  label: string;
}

function TerminalPane({
  project,
  termId,
  visible,
}: {
  project: Project;
  termId: string;
  visible: boolean;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState(project.path);
  const [completions, setCompletions] = useState<string[]>([]);
  const [compIndex, setCompIndex] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Strip ANSI codes
  const stripAnsi = (s: string) =>
    s.replace(
      // eslint-disable-next-line no-control-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      ""
    );

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
    }
  }, [visible, running, output]);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "term:start", termId, cwd: project.path }));
      };

      ws.onclose = () => {
        // Auto-reconnect after 2s
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onmessage = handleMessage;
    }

    function handleMessage(e: MessageEvent) {
      const msg = JSON.parse(e.data);
      if (msg.termId !== termId) return;

      if (msg.type === "term:history") {
        // Replay buffered output from server
        const lines = (msg.lines as string[]).map(stripAnsi).filter((l: string) => l.trim());
        setOutput(lines);
        setCwd(msg.cwd);
        setRunning(msg.running);
      } else if (msg.type === "term:data") {
        const clean = stripAnsi(msg.data);
        if (clean.trim()) {
          setOutput((prev) => [...prev, clean]);
        }
      } else if (msg.type === "term:cwd") {
        setCwd(msg.cwd);
      } else if (msg.type === "term:done") {
        setRunning(false);
        if (msg.code !== 0) {
          setOutput((prev) => [...prev, `[exit ${msg.code}]`]);
        }
      } else if (msg.type === "term:completions") {
        const matches = msg.matches as string[];
        if (matches.length === 1) {
          // Single match — apply it directly
          setInput((prev) => {
            const parts = prev.split(/\s+/);
            const lastWord = parts[parts.length - 1] || "";
            const lastSlash = lastWord.lastIndexOf("/");
            const base = lastSlash >= 0 ? lastWord.slice(0, lastSlash + 1) : "";
            parts[parts.length - 1] = base + matches[0];
            return parts.join(" ");
          });
          setCompletions([]);
        } else if (matches.length > 1) {
          setCompletions(matches);
          setCompIndex(0);
        } else {
          setCompletions([]);
        }
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      // Don't send term:close — we want the terminal to survive
      ws?.close();
    };
  }, [project.path, termId]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cmd = input.trim();
      if (!cmd || !wsRef.current) return;

      // Handle clear locally
      if (cmd === "clear") {
        setOutput([]);
        setInput("");
        return;
      }

      setOutput((prev) => [...prev, `$ ${cmd}`]);
      setRunning(true);

      wsRef.current.send(
        JSON.stringify({ type: "term:command", termId, data: cmd })
      );
      setInput("");
    },
    [input, termId]
  );

  const handleKill = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "term:kill", termId }));
  }, [termId]);

  if (!visible) return null;

  return (
    <div className="flex h-full flex-col bg-[#09090b]" onClick={() => inputRef.current?.focus()}>
      <div
        ref={outputRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-sm scrollbar-visible"
      >
        {output.map((line, i) => (
          <pre
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all leading-relaxed",
              line.startsWith("$ ")
                ? "text-primary"
                : line.startsWith("[exit") || line.startsWith("cd:")
                  ? "text-red-400"
                  : "text-foreground/80"
            )}
          >
            {line}
          </pre>
        ))}

        {/* Completions hint */}
        {completions.length > 1 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0 text-muted-foreground">
            {completions.map((c, i) => (
              <span key={c} className={cn(i === compIndex && "text-primary font-bold")}>
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Inline prompt + input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-0">
          <span className="text-muted-foreground">{cwd.split("/").pop()}</span>
          <span className="text-primary">&nbsp;$&nbsp;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setCompletions([]); }}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                if (completions.length > 1) {
                  // Cycle through completions or apply selected
                  const match = completions[compIndex];
                  setInput((prev) => {
                    const parts = prev.split(/\s+/);
                    const lastWord = parts[parts.length - 1] || "";
                    const lastSlash = lastWord.lastIndexOf("/");
                    const base = lastSlash >= 0 ? lastWord.slice(0, lastSlash + 1) : "";
                    parts[parts.length - 1] = base + match;
                    return parts.join(" ");
                  });
                  setCompletions([]);
                } else {
                  // Request completions from server
                  wsRef.current?.send(
                    JSON.stringify({ type: "term:complete", termId, data: input })
                  );
                }
              }
            }}
            disabled={running}
            placeholder={running ? "..." : ""}
            className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground caret-primary"
            autoFocus
          />
          {running && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-5 text-[10px] px-1.5 ml-2"
              onClick={handleKill}
            >
              Ctrl+C
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

interface Props {
  project: Project;
}

export function TerminalTab({ project }: Props) {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([
    { id: crypto.randomUUID(), label: "1" },
  ]);
  const [activeId, setActiveId] = useState(terminals[0].id);

  const addTerminal = useCallback(() => {
    const newTerm: TerminalInstance = {
      id: crypto.randomUUID(),
      label: String(terminals.length + 1),
    };
    setTerminals((prev) => [...prev, newTerm]);
    setActiveId(newTerm.id);
  }, [terminals.length]);

  const closeTerminal = useCallback(
    (id: string) => {
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const newTerm = { id: crypto.randomUUID(), label: "1" };
          setActiveId(newTerm.id);
          return [newTerm];
        }
        if (activeId === id) {
          setActiveId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeId]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-border bg-card px-2 py-1">
        {terminals.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={cn(
              "group flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors",
              activeId === t.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50"
            )}
          >
            <span className="font-mono">#{t.label}</span>
            {terminals.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(t.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground"
          onClick={addTerminal}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {terminals.map((t) => (
          <TerminalPane
            key={t.id}
            project={project}
            termId={t.id}
            visible={t.id === activeId}
          />
        ))}
      </div>
    </div>
  );
}
