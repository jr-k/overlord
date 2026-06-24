import type { Project, Session } from "../types.js";
import { useApi } from "../hooks/useApi.js";

interface Props {
  project: Project;
}

export function TimelineTab({ project }: Props) {
  const { data: sessions, loading } = useApi<Session[]>(
    `/sessions/${project.id}`
  );

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="max-w-2xl p-6">
      {!sessions || sessions.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No sessions recorded for this project.
        </p>
      ) : (
        <div className="flex flex-col">
          {sessions.map((s, i) => (
            <div key={s.id} className="relative pb-6 pl-7">
              {/* Dot */}
              <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              {/* Line */}
              {i < sessions.length - 1 && (
                <div className="absolute bottom-0 left-1 top-5 w-0.5 bg-border" />
              )}
              {/* Content */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-1 text-xs text-muted-foreground">
                  {new Date(s.startedAt).toLocaleDateString("en-US", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {s.endedAt && (
                    <span className="text-muted-foreground/60">
                      {" "}— {getDuration(s.startedAt, s.endedAt)}
                    </span>
                  )}
                </div>
                <div className="text-sm leading-relaxed text-foreground/80">
                  {s.summary ?? "No summary"}
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
