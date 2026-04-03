import { useState, useCallback } from "react";
import type { Project } from "./types.js";
import { useApi, post } from "./hooks/useApi.js";
import { Sidebar } from "./components/Sidebar.js";
import { SummaryTab } from "./components/SummaryTab.js";
import { ChatTab } from "./components/ChatTab.js";
import { TimelineTab } from "./components/TimelineTab.js";

type Tab = "summary" | "chat" | "timeline";

export function App() {
  const { data: projects, refetch } = useApi<Project[]>("/projects");
  const [selected, setSelected] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  // Persist chat input per project (survives tab switches)
  const [chatInputs, setChatInputs] = useState<Record<number, string>>({});

  const handleScan = useCallback(async () => {
    await post("/projects/scan");
    refetch();
  }, [refetch]);

  const handleSelect = useCallback((p: Project) => {
    setSelected(p);
    setTab("chat");
  }, []);

  return (
    <div style={styles.root}>
      <Sidebar
        projects={projects ?? []}
        selected={selected}
        onSelect={handleSelect}
        onScan={handleScan}
      />

      <main style={styles.main}>
        {selected ? (
          <>
            <div style={styles.tabBar}>
              <h2 style={styles.projectName}>{selected.name}</h2>
              <div style={styles.tabs}>
                {(["summary", "chat", "timeline"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      ...styles.tab,
                      borderBottom:
                        tab === t
                          ? "2px solid #818cf8"
                          : "2px solid transparent",
                      color: tab === t ? "#e0e0e0" : "#666",
                    }}
                  >
                    {t === "summary"
                      ? "Resume"
                      : t === "chat"
                        ? "Chat"
                        : "Timeline"}
                  </button>
                ))}
              </div>
            </div>
            <div style={styles.content}>
              {tab === "summary" && <SummaryTab project={selected} />}
              {tab === "timeline" && <TimelineTab project={selected} />}
              {tab === "chat" && (
                <ChatTab
                  project={selected}
                  input={chatInputs[selected.id] ?? ""}
                  onInputChange={(v) =>
                    setChatInputs((prev) => ({ ...prev, [selected.id]: v }))
                  }
                />
              )}
            </div>
          </>
        ) : (
          <div style={styles.empty}>
            <h2 style={styles.emptyTitle}>Overlord</h2>
            <p style={styles.emptyText}>
              Selectionne un projet ou scanne le repertoire.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    borderBottom: "1px solid #2a2a3a",
    background: "#0e0e16",
  },
  projectName: {
    fontSize: 18,
    fontWeight: 600,
    color: "#e0e0e0",
  },
  tabs: {
    display: "flex",
    gap: 4,
  },
  tab: {
    padding: "16px 20px",
    background: "none",
    border: "none",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "color 0.15s",
  },
  content: {
    flex: 1,
    overflow: "auto",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 32,
    fontWeight: 700,
    color: "#818cf8",
    letterSpacing: 2,
  },
  emptyText: {
    fontSize: 16,
    color: "#555",
  },
};
