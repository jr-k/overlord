import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// @ts-expect-error CSS import handled by Vite
import "@xterm/xterm/css/xterm.css";
import type { Project } from "../types.js";

interface DbMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  thinking: string | null;
  createdAt: string;
}

type AgentStatus = "idle" | "waiting" | "streaming" | "done";

interface Props {
  project: Project;
  input: string;
  onInputChange: (value: string) => void;
}

export function ChatTab({ project, input, onInputChange }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [history, setHistory] = useState<DbMessage[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer for elapsed time while waiting/streaming
  useEffect(() => {
    if (agentStatus === "waiting" || agentStatus === "streaming") {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [agentStatus]);

  // Load last conversation from DB
  useEffect(() => {
    fetch(`/api/conversations/latest/${project.id}`)
      .then((r) => r.json())
      .then((data: { messages: DbMessage[] }) => {
        if (data.messages?.length) {
          setHistory(data.messages);
        }
      })
      .catch(() => {});
  }, [project.id]);

  // Initialize xterm
  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0a0a0f",
        foreground: "#d0d0d0",
        cursor: "#818cf8",
        selectionBackground: "#818cf840",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      cursorStyle: "bar",
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Write previous conversation history
    if (history.length > 0) {
      term.writeln("\x1b[90m--- Conversation precedente ---\x1b[0m\r\n");
      for (const msg of history) {
        if (msg.role === "user") {
          term.writeln(`\x1b[38;5;141m> ${msg.content}\x1b[0m\r`);
        } else {
          term.writeln(`${msg.content}\r`);
        }
      }
      term.writeln("\r\n\x1b[90m--- Nouvelle session ---\x1b[0m\r\n");
    }

    // Handle window resize
    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      terminalRef.current = null;
    };
  }, [project.id, history]);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setSessionActive(false);
      setAgentStatus("idle");
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "chat:chunk" && terminalRef.current) {
        terminalRef.current.write(msg.data);
        // First chunk received — agent is now streaming
        setAgentStatus((prev) =>
          prev === "waiting" || prev === "streaming" ? "streaming" : prev
        );
      } else if (msg.type === "chat:start") {
        setSessionActive(true);
      } else if (msg.type === "chat:end") {
        setAgentStatus("done");
        // Reset to idle after a brief flash
        setTimeout(() => setAgentStatus("idle"), 2000);
      }
    };

    return () => ws.close();
  }, [project.id]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !wsRef.current) return;
    const msg = input.trim();

    setAgentStatus("waiting");

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        projectPath: project.path,
        projectId: project.id,
        message: msg,
      })
    );

    // Echo user input in terminal
    if (terminalRef.current) {
      terminalRef.current.writeln(`\r\n\x1b[38;5;141m> ${msg}\x1b[0m\r`);
    }

    onInputChange("");
  }, [input, project, onInputChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.scope}>claude @ {project.name}</span>
        <div style={styles.headerRight}>
          <StatusIndicator status={agentStatus} elapsed={formatElapsed(elapsed)} />
          <span
            style={{
              ...styles.status,
              color: connected ? "#4ade80" : "#f87171",
            }}
          >
            {connected ? "connecte" : "deconnecte"}
          </span>
        </div>
      </div>

      {/* Status bar below header */}
      {agentStatus === "waiting" && (
        <div style={styles.statusBar}>
          <div style={styles.progressPulse} />
          <span>Demarrage de l'agent Claude... ({formatElapsed(elapsed)})</span>
        </div>
      )}
      {agentStatus === "streaming" && (
        <div style={{ ...styles.statusBar, borderColor: "#4ade8040" }}>
          <div style={{ ...styles.progressPulse, background: "#4ade80" }} />
          <span>Claude travaille... ({formatElapsed(elapsed)})</span>
        </div>
      )}

      <div ref={termRef} style={styles.terminal} />

      <div style={styles.inputRow}>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionActive
              ? `Continuer la conversation...`
              : `Demarrer une session Claude sur ${project.name}...`
          }
          style={styles.input}
          disabled={!connected || agentStatus === "waiting"}
        />
        <button
          onClick={handleSend}
          disabled={!connected || !input.trim() || agentStatus === "waiting"}
          style={{
            ...styles.sendBtn,
            opacity:
              !connected || !input.trim() || agentStatus === "waiting"
                ? 0.4
                : 1,
          }}
        >
          {agentStatus === "waiting" ? "..." : "Envoyer"}
        </button>
      </div>

      <style>{`
        @keyframes pulse-bar {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function StatusIndicator({
  status,
  elapsed,
}: {
  status: AgentStatus;
  elapsed: string;
}) {
  if (status === "idle") return null;

  const config = {
    waiting: { color: "#fbbf24", label: "Demarrage", animate: true },
    streaming: { color: "#4ade80", label: "En cours", animate: true },
    done: { color: "#818cf8", label: "Termine", animate: false },
  }[status];

  if (!config) return null;

  return (
    <span
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 6,
        background: `${config.color}20`,
        color: config.color,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        animation: config.animate ? "pulse-bar 1.5s infinite" : undefined,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: config.color,
          display: "inline-block",
        }}
      />
      {config.label} {status !== "done" && elapsed}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    borderBottom: "1px solid #2a2a3a",
  },
  scope: {
    fontSize: 13,
    fontFamily: "monospace",
    color: "#818cf8",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  status: {
    fontSize: 12,
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 20px",
    fontSize: 12,
    color: "#fbbf24",
    background: "#fbbf2408",
    borderBottom: "1px solid #fbbf2440",
    position: "relative" as const,
    overflow: "hidden",
  },
  progressPulse: {
    width: 20,
    height: 3,
    borderRadius: 2,
    background: "#fbbf24",
    animation: "slide 1.5s infinite ease-in-out",
  },
  terminal: {
    flex: 1,
    padding: "8px 4px",
    overflow: "hidden",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: 16,
    borderTop: "1px solid #2a2a3a",
    background: "#12121a",
    minHeight: "15vh",
    maxHeight: "20vh",
    alignItems: "stretch",
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    background: "#1e1e2e",
    border: "1px solid #2a2a3a",
    borderRadius: 8,
    color: "#e0e0e0",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    height: "100%",
  },
  sendBtn: {
    padding: "12px 20px",
    background: "#818cf8",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    alignSelf: "flex-end",
  },
};
