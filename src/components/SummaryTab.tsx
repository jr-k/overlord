import type { Project, Session } from "../types.js";
import { useApi } from "../hooks/useApi.js";

interface Props {
  project: Project;
}

export function SummaryTab({ project }: Props) {
  const { data: sessions } = useApi<Session[]>(
    `/sessions/${project.id}`
  );

  const latest = sessions?.[0];

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Status</h3>
        <div style={styles.statusRow}>
          <StatusBadge status={project.status} />
          <span style={styles.path}>{project.path}</span>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Dernier resume</h3>
        {latest?.summary ? (
          <p style={styles.summary}>{latest.summary}</p>
        ) : (
          <p style={styles.empty}>
            Aucun resume de session. Lance un chat pour commencer.
          </p>
        )}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Sessions recentes</h3>
        {sessions && sessions.length > 0 ? (
          <div style={styles.sessionList}>
            {sessions.slice(0, 5).map((s) => (
              <div key={s.id} style={styles.sessionItem}>
                <span style={styles.sessionDate}>
                  {new Date(s.startedAt).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span style={styles.sessionSummary}>
                  {s.summary ?? "Pas de resume"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={styles.empty}>Aucune session.</p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "#4ade80",
    paused: "#fbbf24",
    blocked: "#f87171",
  };
  return (
    <span
      style={{
        padding: "4px 12px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: `${colors[status]}20`,
        color: colors[status],
        textTransform: "uppercase" as const,
      }}
    >
      {status}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 800,
  },
  card: {
    background: "#12121a",
    border: "1px solid #2a2a3a",
    borderRadius: 12,
    padding: 20,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color: "#666",
    marginBottom: 12,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  path: {
    fontSize: 13,
    color: "#888",
    fontFamily: "monospace",
  },
  summary: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "#ccc",
  },
  empty: {
    fontSize: 14,
    color: "#555",
    fontStyle: "italic",
  },
  sessionList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sessionItem: {
    display: "flex",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #1e1e2e",
  },
  sessionDate: {
    fontSize: 12,
    color: "#666",
    whiteSpace: "nowrap" as const,
    minWidth: 100,
  },
  sessionSummary: {
    fontSize: 13,
    color: "#aaa",
  },
};
