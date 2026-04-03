import type { Project } from "../types.js";

const STATUS_COLORS = {
  active: "#4ade80",
  paused: "#fbbf24",
  blocked: "#f87171",
};

interface Props {
  projects: Project[];
  selected: Project | null;
  onSelect: (p: Project) => void;
  onScan: () => void;
}

export function Sidebar({ projects, selected, onSelect, onScan }: Props) {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <h1 style={styles.title}>OVERLORD</h1>
      </div>

      <div style={styles.list}>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            style={{
              ...styles.item,
              background: selected?.id === p.id ? "#1e1e2e" : "transparent",
              borderLeft:
                selected?.id === p.id
                  ? "3px solid #818cf8"
                  : "3px solid transparent",
            }}
          >
            <span
              style={{
                ...styles.dot,
                background: STATUS_COLORS[p.status],
              }}
            />
            <span style={styles.name}>{p.name}</span>
          </button>
        ))}
      </div>

      <button onClick={onScan} style={styles.scanBtn}>
        Scan projects
      </button>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 240,
    minWidth: 240,
    background: "#12121a",
    borderRight: "1px solid #2a2a3a",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    padding: "20px 16px 12px",
    borderBottom: "1px solid #2a2a3a",
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 3,
    color: "#818cf8",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 16px",
    border: "none",
    color: "#e0e0e0",
    cursor: "pointer",
    fontSize: 14,
    textAlign: "left" as const,
    transition: "background 0.15s",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  scanBtn: {
    margin: 12,
    padding: "10px 16px",
    background: "#1e1e2e",
    border: "1px solid #2a2a3a",
    borderRadius: 8,
    color: "#818cf8",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
};
