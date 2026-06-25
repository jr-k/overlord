import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Code2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface EditorInfo {
  id: string;
  name: string;
  cmd: string;
}

let editorsCache: EditorInfo[] | null = null;

const MAC_FALLBACK_EDITORS: EditorInfo[] = [
  { id: "cursor", name: "Cursor", cmd: "cursor" },
  { id: "vscode", name: "VS Code", cmd: "code" },
];

function getFallbackEditors() {
  return navigator.platform.toLowerCase().includes("mac") ? MAC_FALLBACK_EDITORS : [];
}

function useEditors() {
  const [editors, setEditors] = useState<EditorInfo[]>(editorsCache ?? []);
  useEffect(() => {
    if (editorsCache) return;
    fetch("/api/editors")
      .then((r) => r.json())
      .then((data) => {
        const nextEditors = Array.isArray(data) && data.length > 0 ? data : getFallbackEditors();
        editorsCache = nextEditors;
        setEditors(nextEditors);
      })
      .catch(() => setEditors(getFallbackEditors()));
  }, []);
  return editors;
}

function getPreferredEditor(): string | null {
  return localStorage.getItem("overlord:editor");
}

function setPreferredEditor(id: string) {
  localStorage.setItem("overlord:editor", id);
}

export function OpenInEditorButton({ path, className }: { path: string; className?: string }) {
  const editors = useEditors();
  const [showPicker, setShowPicker] = useState(false);
  const preferred = getPreferredEditor();

  const open = useCallback(
    (editorId: string) => {
      setPreferredEditor(editorId);
      setShowPicker(false);
      fetch("/api/editor/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: path, editor: editorId }),
      });
    },
    [path]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (preferred) open(preferred);
      else setShowPicker(true);
    },
    [preferred, open]
  );

  if (editors.length === 0) return null;

  const preferredEditor = editors.find((e) => e.id === preferred);

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={handleClick}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowPicker(true);
            }}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              className
            )}
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs z-[100]">
          {preferredEditor ? `Open in ${preferredEditor.name}` : "Open in an editor"}
          <span className="text-muted-foreground ml-1">(right-click to change)</span>
        </TooltipContent>
      </Tooltip>

      {showPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
          <div className="absolute right-0 top-6 z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg">
            {editors.map((ed) => (
              <button
                key={ed.id}
                onClick={(e) => { e.stopPropagation(); open(ed.id); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                  preferred === ed.id && "text-primary font-medium"
                )}
              >
                {ed.name}
                {preferred === ed.id && (
                  <span className="ml-auto text-[10px] text-muted-foreground">default</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
