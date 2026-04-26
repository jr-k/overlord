import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

export interface PasteBlock {
  id: string;
  content: string;
  lineCount: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPasteBlock?: (block: PasteBlock) => void;
  onRemoveBlock?: (id: string) => void;
  blocks: PasteBlock[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export interface RichPasteInputHandle {
  focus: () => void;
}

// Serialize DOM children into our placeholder format
function domToValue(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        out += "\n";
        return;
      }
      const blockId = el.dataset.blockId;
      if (blockId) {
        out += `{{paste:${blockId}}}`;
        return;
      }
      // For div/span wrappers, add newline for div, recurse children
      if (el.tagName === "DIV" && out.length > 0 && !out.endsWith("\n")) {
        out += "\n";
      }
      node.childNodes.forEach(walk);
    }
  };
  root.childNodes.forEach(walk);
  return out;
}

// Parse a placeholder-containing string into an array of text and block tokens
function valueToTokens(value: string, blocks: PasteBlock[]): Array<{ type: "text"; text: string } | { type: "block"; block: PasteBlock }> {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const tokens: Array<{ type: "text"; text: string } | { type: "block"; block: PasteBlock }> = [];
  const regex = /\{\{paste:([^}]+)\}\}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: "text", text: value.slice(lastIndex, match.index) });
    const block = blocksById.get(match[1]);
    if (block) tokens.push({ type: "block", block });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) tokens.push({ type: "text", text: value.slice(lastIndex) });
  return tokens;
}

export const RichPasteInput = forwardRef<RichPasteInputHandle, Props>(function RichPasteInput(
  { value, onChange, onPasteBlock, onRemoveBlock, blocks, placeholder, disabled, className, onKeyDown },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string>("");
  const blocksRef = useRef<PasteBlock[]>(blocks);
  blocksRef.current = blocks;

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
  }), []);

  // Render value to DOM (only when value changes externally, not during typing)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastValueRef.current) return; // avoid re-render during typing

    // Preserve cursor position as offset from start when rerendering external changes
    el.innerHTML = "";
    const tokens = valueToTokens(value, blocksRef.current);
    for (const token of tokens) {
      if (token.type === "text") {
        // Split by newlines, add <br> between lines
        const lines = token.text.split("\n");
        lines.forEach((line, i) => {
          if (i > 0) el.appendChild(document.createElement("br"));
          if (line) el.appendChild(document.createTextNode(line));
        });
      } else {
        const span = document.createElement("span");
        span.contentEditable = "false";
        span.dataset.blockId = token.block.id;
        span.className = "inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 mx-0.5 text-[11px] text-primary font-mono select-none align-middle cursor-default";
        span.title = token.block.content.slice(0, 500) + (token.block.content.length > 500 ? "..." : "");
        span.textContent = `📎 ${token.block.lineCount} ligne${token.block.lineCount > 1 ? "s" : ""}`;
        el.appendChild(span);
      }
    }
    lastValueRef.current = value;
  }, [value]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const newValue = domToValue(el);
    lastValueRef.current = newValue;

    // Detect removed blocks (blocks in state but no longer in DOM)
    const currentBlockIds = new Set<string>();
    el.querySelectorAll("[data-block-id]").forEach((n) => {
      const id = (n as HTMLElement).dataset.blockId;
      if (id) currentBlockIds.add(id);
    });
    for (const block of blocksRef.current) {
      if (!currentBlockIds.has(block.id)) {
        onRemoveBlock?.(block.id);
      }
    }

    onChange(newValue);
  }, [onChange, onRemoveBlock]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text");
    const lineCount = pasted.split("\n").length;

    if (lineCount <= 5) {
      // Short paste: insert as plain text at cursor
      e.preventDefault();
      document.execCommand("insertText", false, pasted);
      return;
    }

    // Long paste: insert a block chip at cursor
    e.preventDefault();
    const id = crypto.randomUUID();
    const block: PasteBlock = { id, content: pasted, lineCount };

    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.blockId = id;
    span.className = "inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 mx-0.5 text-[11px] text-primary font-mono select-none align-middle cursor-default";
    span.title = pasted.slice(0, 500) + (pasted.length > 500 ? "..." : "");
    span.textContent = `📎 ${lineCount} lignes`;

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(span);
      // Move cursor after the inserted span
      range.setStartAfter(span);
      range.setEndAfter(span);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editorRef.current?.appendChild(span);
    }

    onPasteBlock?.(block);

    // Trigger onChange with new value
    setTimeout(() => {
      const el = editorRef.current;
      if (!el) return;
      const newValue = domToValue(el);
      lastValueRef.current = newValue;
      onChange(newValue);
    }, 0);
  }, [onChange, onPasteBlock]);

  const isEmpty = !value || value.length === 0;

  return (
    <div className="relative flex-1 min-w-0">
      {isEmpty && placeholder && (
        <div className="pointer-events-none absolute left-4 top-3 text-sm text-muted-foreground">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full h-full min-h-full resize-none overflow-y-auto rounded-lg border bg-secondary px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring whitespace-pre-wrap break-words",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{ minHeight: "100%" }}
      />
    </div>
  );
});
