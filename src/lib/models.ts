export interface ModelOption {
  /** Value passed to `claude --model`. Empty means the CLI default. */
  id: string;
  /** Full label shown in Settings. */
  label: string;
  /** Compact label shown in the chat header. */
  short: string;
}

// Use aliases (opus, sonnet, haiku) instead of versioned IDs.
// Claude CLI resolves them to the latest available model automatically.
// This avoids manual updates when new model versions are released.
export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "", label: "Default (Claude CLI default)", short: "Default" },
  { id: "opus", label: "Claude Opus (latest)", short: "Opus" },
  { id: "opus[1m]", label: "Claude Opus (latest, 1M context)", short: "Opus 1M" },
  { id: "sonnet", label: "Claude Sonnet (latest)", short: "Sonnet" },
  { id: "sonnet[1m]", label: "Claude Sonnet (latest, 1M context)", short: "Sonnet 1M" },
  { id: "haiku", label: "Claude Haiku (latest)", short: "Haiku" },
];

// Turn the full ID returned by the CLI `system/init` event into a readable label.
// Example: "claude-opus-4-8-20260115" becomes "Opus 4.8".
export function formatModelVersion(id: string): string {
  if (!id) return "";
  const oneM = /\[1m\]/i.test(id) ? " (1M)" : "";
  const m = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (m) {
    const fam = m[1][0].toUpperCase() + m[1].slice(1);
    return `${fam} ${m[2]}.${m[3]}${oneM}`;
  }
  return id.replace(/^claude-/, "") + oneM;
}
