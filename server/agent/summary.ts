import { spawn } from "child_process";
import { db } from "../db/index.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AgentSession } from "./types.js";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

export function generateSummary(session: AgentSession) {
  const exchanges: string[] = [];
  for (const ev of session.events.slice(-20) as any[]) {
    if (ev.type === "user_message") {
      exchanges.push(`User: ${ev.content}`);
    } else if (ev.type === "result" && ev.result) {
      exchanges.push(`Assistant: ${ev.result.slice(0, 500)}`);
    }
  }

  if (exchanges.length === 0) return;

  const prompt = `Tu es un assistant qui genere des resumes de projet. Voici les derniers echanges sur ce projet. Genere un resume concis (3-5 lignes max) qui repond a: 1) C'est quoi ce projet ? 2) Quelles sont les dernieres choses faites ? Reponds uniquement avec le resume, pas de preamble.\n\n${exchanges.join("\n\n")}`;

  console.log(`[summary:${session.projectId}] generating summary...`);

  const proc = spawn(CLAUDE_PATH, ["--print", "--", prompt], {
    cwd: session.projectPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout!.on("data", (data: Buffer) => { output += data.toString(); });

  proc.on("close", (code) => {
    if (code === 0 && output.trim()) {
      console.log(`[summary:${session.projectId}] saved (${output.trim().length} chars)`);
      db.update(projects)
        .set({
          summary: output.trim(),
          lastSummaryAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(projects.id, session.projectId))
        .run();
    } else {
      console.log(`[summary:${session.projectId}] failed code=${code}`);
    }
  });
}
