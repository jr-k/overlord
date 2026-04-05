import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "../types.js";
import { useApi } from "../hooks/useApi.js";

interface ProjectWithSummary extends Project {
  summary: string | null;
  lastSummaryAt: string | null;
}

interface Conversation {
  id: number;
  title: string | null;
  createdAt: string;
}

interface Props {
  project: Project;
}

export function SummaryTab({ project }: Props) {
  const { data: fullProject } = useApi<ProjectWithSummary>(
    `/projects/${project.id}`
  );
  const { data: conversations } = useApi<Conversation[]>(
    `/conversations/${project.id}`
  );

  const summary = fullProject?.summary;
  const lastSummaryAt = fullProject?.lastSummaryAt;

  return (
    <div className="flex max-w-3xl flex-col gap-4 p-6">
      {/* Project summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Resume du projet</CardTitle>
          {lastSummaryAt && (
            <CardDescription className="text-xs">
              Mis a jour le{" "}
              {new Date(lastSummaryAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
              {summary}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              Aucun resume disponible. Le resume sera genere automatiquement apres ta prochaine conversation avec Claude.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Project info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Infos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Chemin</span>
              <span className="font-mono text-xs text-foreground/70">{project.path}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conversations</span>
              <span>{conversations?.length ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cree le</span>
              <span className="text-foreground/70">
                {new Date(project.createdAt).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent conversations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conversations recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {conversations && conversations.length > 0 ? (
            <div className="flex flex-col gap-2">
              {conversations.slice(0, 10).map((c) => (
                <div
                  key={c.id}
                  className="flex gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="min-w-[120px] shrink-0 text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="truncate text-sm text-foreground/70">
                    {c.title ?? "Session sans titre"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              Aucune conversation.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
