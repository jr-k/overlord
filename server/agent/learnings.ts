import { spawn } from "child_process";
import { db } from "../db/index.js";
import { learnings } from "../db/schema.js";
import { broadcastAll } from "../ws.js";
import type { AgentSession } from "./types.js";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

export function generateLearnings(session: AgentSession) {
  broadcastAll({ type: "learnings:generating", projectId: session.projectId });

  const transcript: string[] = [];
  for (const ev of session.events as any[]) {
    if (ev.type === "user_message") {
      transcript.push(`USER: ${ev.content}`);
    } else if (ev.type === "assistant") {
      const blocks = ev.message?.content ?? [];
      for (const b of blocks) {
        if (b.type === "text" && b.text) transcript.push(`ASSISTANT: ${b.text.slice(0, 1000)}`);
        else if (b.type === "tool_use") {
          const input = typeof b.input === "object" ? JSON.stringify(b.input).slice(0, 300) : String(b.input).slice(0, 300);
          transcript.push(`TOOL_USE: ${b.name}(${input})`);
        }
      }
    } else if (ev.type === "result" && ev.result) {
      transcript.push(`RESULT: ${String(ev.result).slice(0, 500)}`);
    }
  }
  const transcriptText = transcript.join("\n").slice(-30000);

  const prompt = `You are analyzing a completed Claude Code session to extract compounding learnings for the project repo.

Find:
1. **Dead ends** — where the agent took a wrong direction before course-correcting. Concrete examples.
2. **Missing context** — what was NOT in the repo/CLAUDE.md/skills that would have helped the agent reach the goal faster (patterns, conventions, undocumented constraints, implicit decisions).
3. **Recommendations** — specific, actionable additions for the repo: skills to create, CLAUDE.md entries to add, patterns to document, conventions to make explicit.

Output strict markdown with exactly these 3 sections:

## Dead Ends

(bullet list of wrong directions taken, if any. "None" if session was clean.)

## Missing Context

(bullet list of specific missing info. Each bullet: what was missing + how it would have helped.)

## Recommendations

(bullet list of concrete, actionable improvements. Each bullet starts with an action verb: "Add...", "Document...", "Create skill...", "Define convention...".)

Be specific and concise. No preamble, no fluff. If the session was trivial or clean, say so briefly.

---

TRANSCRIPT:
${transcriptText}`;

  console.log(`[learnings:${session.projectId}] generating...`);

  const proc = spawn(CLAUDE_PATH, ["--print", "--", prompt], {
    cwd: session.projectPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
  proc.stderr!.on("data", () => {});

  const timeout = setTimeout(() => { proc.kill("SIGTERM"); }, 3 * 60 * 1000);

  proc.on("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0 || !output.trim()) {
      console.log(`[learnings:${session.projectId}] failed code=${code}`);
      broadcastAll({ type: "learnings:done", projectId: session.projectId, success: false });
      return;
    }

    const extractSection = (heading: string): string | null => {
      const regex = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
      const match = output.match(regex);
      return match ? match[1].trim() : null;
    };

    const deadEnds = extractSection("Dead Ends");
    const missingContext = extractSection("Missing Context");
    const recommendations = extractSection("Recommendations");

    db.insert(learnings)
      .values({
        projectId: session.projectId,
        conversationId: session.conversationId,
        deadEnds,
        missingContext,
        recommendations,
        rawReport: output.trim(),
      })
      .run();

    console.log(`[learnings:${session.projectId}] saved`);
    broadcastAll({ type: "learnings:done", projectId: session.projectId, success: true });
  });
}
