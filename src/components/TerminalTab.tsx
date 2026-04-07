import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, ExternalLink } from "lucide-react";
import type { Project } from "../types.js";

interface Props {
  project: Project;
}

export function TerminalTab({ project }: Props) {
  const openTerminal = useCallback(() => {
    // Use the API to open the system terminal in the project directory
    fetch("/api/terminal/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path }),
    });
  }, [project.path]);

  return (
    <div className="flex max-w-xl flex-col items-center justify-center gap-6 p-6 mx-auto h-full">
      <Terminal className="h-12 w-12 text-muted-foreground/40" />
      <div className="text-center">
        <h3 className="text-sm font-semibold mb-1">Terminal</h3>
        <p className="text-xs text-muted-foreground">
          Ouvre ton terminal par defaut dans le dossier du projet.
        </p>
      </div>
      <Button onClick={openTerminal} className="gap-2">
        <ExternalLink className="h-4 w-4" />
        Ouvrir dans le terminal
      </Button>
      <p className="text-[11px] text-muted-foreground font-mono">{project.path}</p>
    </div>
  );
}
