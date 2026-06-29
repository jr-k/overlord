import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Terminal } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface TerminalInfo {
  id: string;
  name: string;
}

let terminalsCache: TerminalInfo[] | null = null;

function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>(terminalsCache ?? []);
  useEffect(() => {
    if (terminalsCache) return;
    fetch("/api/terminals")
      .then((r) => r.json())
      .then((data) => {
        terminalsCache = data;
        setTerminals(data);
      })
      .catch(() => {});
  }, []);
  return terminals;
}

function getPreferredTerminal(): string | null {
  return localStorage.getItem("overlord:terminal");
}

function setPreferredTerminal(id: string) {
  localStorage.setItem("overlord:terminal", id);
}

export function OpenTerminalButton({ path, className }: { path: string; className?: string }) {
  const terminals = useTerminals();
  const [showPicker, setShowPicker] = useState(false);
  const preferred = getPreferredTerminal();

  const open = useCallback(
    (terminalId: string) => {
      setPreferredTerminal(terminalId);
      setShowPicker(false);
      fetch("/api/terminal/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, terminal: terminalId }),
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

  if (terminals.length === 0) return null;

  const preferredTerminal = terminals.find((terminal) => terminal.id === preferred);

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
            <Terminal className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs z-[100]">
          {preferredTerminal ? `Open in ${preferredTerminal.name}` : "Open in a terminal"}
          <span className="text-muted-foreground ml-1">(right-click to change)</span>
        </TooltipContent>
      </Tooltip>

      {showPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
          <div className="absolute right-0 top-8 z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg">
            {terminals.map((terminal) => (
              <button
                key={terminal.id}
                onClick={(e) => { e.stopPropagation(); open(terminal.id); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                  preferred === terminal.id && "text-primary font-medium"
                )}
              >
                {terminal.name}
                {preferred === terminal.id && (
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
