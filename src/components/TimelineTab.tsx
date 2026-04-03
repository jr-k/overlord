import type { Project, Session } from "../types.js";
import { useApi } from "../hooks/useApi.js";

interface Props {
  project: Project;
}

export function TimelineTab({ project }: Props) {
  const { data: sessions, loading } = useApi<Session[]>(
    `/sessions/${project.id}`
  );

  if (loading) return <div style={styles.loading}>Chargement...</div>;

  return (
    <div style={styles.container}>
      {!sessions || sessions.length === 0 ? (
        <p style={styles.empty}>
          Aucune session enregistree pour ce projet.
        </p>
      ) : (
        <div style={styles.timeline}>
          {sessions.map((s) => (
            <div key={s.id} style={styles.entry}>
              <div style={styles.dot} />
              <div style={styles.line} />
              <div style={styles.content}>
                <div style={styles.date}>
                  {new Date(s.startedAt).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {s.endedAt && (
                    <span style={styles.duration}>
                      {" "}
                      — {getDuration(s.startedAt, s.endedAt)}
                    </span>
                  )}
                </div>
                <div style={styles.summary}>
                  {s.summary ?? "Pas de resume"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}h${mins % 60}min`;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 700,
  },
  loading: {
    padding: 24,
    color: "#666",
  },
  empty: {
    color: "#555",
    fontStyle: "italic",
    fontSize: 14,
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
  },
  entry: {
    position: "relative",
    paddingLeft: 28,
    paddingBottom: 24,
  },
  dot: {
    position: "absolute",
    left: 0,
    top: 6,
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#818cf8",
  },
  line: {
    position: "absolute",
    left: 4,
    top: 20,
    bottom: 0,
    width: 2,
    background: "#2a2a3a",
  },
  content: {
    background: "#12121a",
    border: "1px solid #2a2a3a",
    borderRadius: 10,
    padding: 16,
  },
  date: {
    fontSize: 12,
    color: "#888",
    marginBottom: 6,
  },
  duration: {
    color: "#666",
  },
  summary: {
    fontSize: 14,
    color: "#ccc",
    lineHeight: 1.6,
  },
};
