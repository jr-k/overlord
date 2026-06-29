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

  const prompt = `You are an assistant that generates project summaries. Here are the latest exchanges for this project. Generate a concise summary (3-5 lines max) that answers: 1) What is this project? 2) What are the latest things that were done? Reply only with the summary, with no preamble.\n\n${exchanges.join("\n\n")}`;

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
