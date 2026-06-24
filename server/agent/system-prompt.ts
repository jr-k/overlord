import { isIndexed as isCodegraphIndexed } from "../routes/codegraph.js";
import { buildMarketingSystemPrompt } from "./marketing-prompt.js";
import type { Channel } from "./types.js";

export const DEFAULT_CHAT_PROMPT = "Match the language of the user's message in your response. When you respond in French, always use proper French accents.";

export const CODEGRAPH_NUDGE = `

[CODEGRAPH AVAILABLE]
This project has a CodeGraph index (.codegraph/) — a parsed knowledge graph of all symbols, references, and call relationships. PREFER these MCP tools over raw Read/Grep/Glob for code exploration:
- mcp__codegraph__codegraph_search — find symbols (functions, classes, types) by name. Faster + more precise than Grep.
- mcp__codegraph__codegraph_context — build a context bundle for a task. Use this BEFORE diving into Read for any non-trivial change.
- mcp__codegraph__codegraph_callers / codegraph_callees — find who calls a function / what a function calls. Replaces multi-file Grep.
- mcp__codegraph__codegraph_impact — find files affected by changing a symbol.
- mcp__codegraph__codegraph_node — get full info on one symbol (signature, doc, location).
- mcp__codegraph__codegraph_explore — graph traversal from a starting symbol.
- mcp__codegraph__codegraph_files — list files (with optional filtering). Replaces Glob.
- mcp__codegraph__codegraph_status — index health check.

Heuristic: if the task involves "where is X used", "find all Y", "what depends on Z", or "context for editing W" — start with CodeGraph. Fall back to Read/Grep only when CodeGraph returns nothing useful.
[/CODEGRAPH AVAILABLE]`;

export interface EffectivePromptParts {
  base: string;
  nudges: { name: string; content: string; reason: string }[];
  full: string;
}

export function buildEffectiveSystemPrompt(
  project: any,
  channel: Channel,
  projectPath: string
): EffectivePromptParts {
  const base = channel === "marketing"
    ? buildMarketingSystemPrompt(project)
    : (project?.systemPrompt || DEFAULT_CHAT_PROMPT);

  const nudges: EffectivePromptParts["nudges"] = [];

  if (channel === "chat" && isCodegraphIndexed(projectPath)) {
    nudges.push({
      name: "Codegraph",
      content: CODEGRAPH_NUDGE,
      reason: ".codegraph/ found in project — auto-injected",
    });
  }

  const full = base + nudges.map((n) => n.content).join("");
  return { base, nudges, full };
}
