import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  FileText, FolderSearch, Terminal, Pencil, FilePlus,
  Search, Globe, ChevronDown, ChevronRight, Eye, ExternalLink
} from "lucide-react";

interface Props {
  name: string;
  input?: Record<string, any>;
  result?: string;
}

interface EditorInfo {
  id: string;
  name: string;
  cmd: string;
}

const TOOL_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  Read:       { icon: Eye,          label: "Lecture",       color: "text-blue-400" },
  Edit:       { icon: Pencil,       label: "Edition",       color: "text-amber-400" },
  Write:      { icon: FilePlus,     label: "Ecriture",      color: "text-green-400" },
  Bash:       { icon: Terminal,     label: "Commande",      color: "text-purple-400" },
  Glob:       { icon: FolderSearch, label: "Recherche",     color: "text-cyan-400" },
  Grep:       { icon: Search,       label: "Recherche",     color: "text-cyan-400" },
  WebFetch:   { icon: Globe,        label: "Web",           color: "text-pink-400" },
  WebSearch:  { icon: Globe,        label: "Recherche web", color: "text-pink-400" },
};

function getToolInfo(name: string) {
  const shortName = name.includes("__") ? name.split("__").pop() ?? name : name;
  return TOOL_CONFIG[shortName] ?? { icon: FileText, label: shortName, color: "text-muted-foreground" };
}

function shortenPath(p: string): string {
  const match = p.match(/(?:Developer|Projects|repos|workspace|code|home\/\w+)\/(.*)/i);
  if (match) return match[1];
  const parts = p.split("/");
  return parts.length > 3 ? parts.slice(-3).join("/") : p;
}

function formatInput(name: string, input?: Record<string, any>): string | null {
  if (!input) return null;
  if (name === "Read" && input.file_path) return shortenPath(input.file_path);
  if (name === "Edit" && input.file_path) return shortenPath(input.file_path);
  if (name === "Write" && input.file_path) return shortenPath(input.file_path);
  if (name === "Bash" && input.command) return input.command;
  if (name === "Glob" && input.pattern) return input.pattern;
  if (name === "Grep" && input.pattern) return input.pattern;
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length < 200) return v;
  }
  return null;
}

function hasFilePath(name: string): boolean {
  return ["Read", "Edit", "Write"].includes(name);
}

// ─── Editor Picker ───────────────────────────────────────────

let editorsCache: EditorInfo[] | null = null;

function useEditors() {
  const [editors, setEditors] = useState<EditorInfo[]>(editorsCache ?? []);

  useEffect(() => {
    if (editorsCache) return;
    fetch("/api/editors")
      .then((r) => r.json())
      .then((data) => {
        editorsCache = data;
        setEditors(data);
      })
      .catch(() => {});
  }, []);

  return editors;
}

function getPreferredEditor(): string | null {
  return localStorage.getItem("overlord:editor");
}

function setPreferredEditor(id: string) {
  localStorage.setItem("overlord:editor", id);
}

function EditorButton({ filePath }: { filePath: string }) {
  const editors = useEditors();
  const [showPicker, setShowPicker] = useState(false);
  const preferred = getPreferredEditor();

  const openInEditor = useCallback(
    (editorId: string) => {
      setPreferredEditor(editorId);
      setShowPicker(false);
      fetch("/api/editor/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, editor: editorId }),
      });
    },
    [filePath]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (preferred) {
        openInEditor(preferred);
      } else {
        setShowPicker(true);
      }
    },
    [preferred, openInEditor]
  );

  if (editors.length === 0) return null;

  return (
    <div className="relative">
      <span
        role="button"
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowPicker(true);
        }}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-secondary cursor-pointer"
        title={preferred ? `Ouvrir dans ${editors.find((e) => e.id === preferred)?.name ?? preferred}` : "Ouvrir dans l'editeur"}
      >
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </span>

      {showPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowPicker(false); }} />
          <div className="absolute right-0 top-6 z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg">
            {editors.map((ed) => (
              <button
                key={ed.id}
                onClick={(e) => { e.stopPropagation(); openInEditor(ed.id); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                  preferred === ed.id && "text-primary font-medium"
                )}
              >
                {ed.name}
                {preferred === ed.id && <span className="ml-auto text-[10px] text-muted-foreground">defaut</span>}
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1 px-2 py-1 text-[10px] text-muted-foreground">
              Clic droit pour changer
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Diff View ───────────────────────────────────────────────

function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed overflow-x-auto select-text">
      {oldStr && (
        <div className="text-red-400/80">
          {oldStr.split("\n").map((line, i) => (
            <div key={`old-${i}`}>- {line}</div>
          ))}
        </div>
      )}
      {newStr && (
        <div className="text-green-400/80 mt-1">
          {newStr.split("\n").map((line, i) => (
            <div key={`new-${i}`}>+ {line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function ToolUseCard({ name, input, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const info = getToolInfo(name);
  const Icon = info.icon;
  const summary = formatInput(name, input);

  const hasDiff = name === "Edit" && input?.old_string && input?.new_string;
  const hasContent = name === "Write" && input?.content;
  const hasCommand = name === "Bash" && input?.command;
  const hasDetails = hasDiff || hasContent || hasCommand || result;
  const showOpenBtn = hasFilePath(name) && input?.file_path;

  return (
    <div className="rounded-lg border border-border bg-secondary/30 text-xs">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          hasDetails && "cursor-pointer hover:bg-secondary/50"
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", info.color)} />
        <span className="font-medium text-foreground/80">{info.label}</span>
        {summary && (
          <span className="truncate font-mono text-muted-foreground">
            {summary}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {showOpenBtn && <EditorButton filePath={input!.file_path} />}
          {hasDetails && (
            <span className="text-muted-foreground">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2">
          {hasDiff && (
            <DiffView oldStr={input.old_string} newStr={input.new_string} />
          )}

          {hasContent && (
            <div className="mt-1 rounded-md border border-border bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-48 overflow-y-auto text-green-400/80 select-text">
              {input.content.split("\n").map((line: string, i: number) => (
                <div key={i}>+ {line}</div>
              ))}
            </div>
          )}

          {hasCommand && !hasDiff && !hasContent && (
            <pre className="rounded-md bg-secondary/50 p-2 font-mono text-[11px] text-foreground/70 overflow-x-auto select-text">
              $ {input.command}
            </pre>
          )}

          {result && (
            <pre className="mt-2 rounded-md bg-secondary/50 p-2 font-mono text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap select-text">
              {result.slice(0, 2000)}{result.length > 2000 ? "\n..." : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
