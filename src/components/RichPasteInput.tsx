import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

export interface PasteBlock {
  id: string;
  content: string;
  lineCount: number;
}

export interface FileBlock {
  id: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPasteBlock?: (block: PasteBlock) => void;
  onRemoveBlock?: (id: string) => void;
  blocks: PasteBlock[];
  fileBlocks?: FileBlock[];
  onFileSelect?: (file: File) => Promise<FileBlock | null>;
  onRemoveFileBlock?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
      const fileId = el.dataset.fileId;
      if (fileId) {
        out += `{{file:${fileId}}}`;
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

type Token =
  | { type: "text"; text: string }
  | { type: "block"; block: PasteBlock }
  | { type: "file"; file: FileBlock };

// Parse a placeholder-containing string into an array of text and block tokens
function valueToTokens(value: string, blocks: PasteBlock[], fileBlocks: FileBlock[]): Token[] {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const filesById = new Map(fileBlocks.map((f) => [f.id, f]));
  const tokens: Token[] = [];
  const regex = /\{\{(paste|file):([^}]+)\}\}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: "text", text: value.slice(lastIndex, match.index) });
    if (match[1] === "paste") {
      const block = blocksById.get(match[2]);
      if (block) tokens.push({ type: "block", block });
    } else {
      const file = filesById.get(match[2]);
      if (file) tokens.push({ type: "file", file });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) tokens.push({ type: "text", text: value.slice(lastIndex) });
  return tokens;
}

export const RichPasteInput = forwardRef<RichPasteInputHandle, Props>(function RichPasteInput(
  { value, onChange, onPasteBlock, onRemoveBlock, blocks, fileBlocks = [], onFileSelect, onRemoveFileBlock, placeholder, disabled, className, onKeyDown },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef<string>("");
  const blocksRef = useRef<PasteBlock[]>(blocks);
  const fileBlocksRef = useRef<FileBlock[]>(fileBlocks);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  blocksRef.current = blocks;
  fileBlocksRef.current = fileBlocks;

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
    const tokens = valueToTokens(value, blocksRef.current, fileBlocksRef.current);
    for (const token of tokens) {
      if (token.type === "text") {
        // Split by newlines, add <br> between lines
        const lines = token.text.split("\n");
        lines.forEach((line, i) => {
          if (i > 0) el.appendChild(document.createElement("br"));
          if (line) el.appendChild(document.createTextNode(line));
        });
      } else if (token.type === "block") {
        const span = document.createElement("span");
        span.contentEditable = "false";
        span.dataset.blockId = token.block.id;
        span.className = "inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 mx-0.5 text-[11px] text-primary font-mono select-none align-middle cursor-default";
        span.title = token.block.content.slice(0, 500) + (token.block.content.length > 500 ? "..." : "");
        span.textContent = `📎 ${token.block.lineCount} line${token.block.lineCount > 1 ? "s" : ""}`;
        el.appendChild(span);
      } else {
        const span = document.createElement("span");
        span.contentEditable = "false";
        span.dataset.fileId = token.file.id;
        span.className = "inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 mx-0.5 text-[11px] text-primary font-mono select-none align-middle cursor-default";
        span.title = `${token.file.filename} • ${formatBytes(token.file.size)}`;
        span.textContent = `📄 ${token.file.filename} (${formatBytes(token.file.size)})`;
        el.appendChild(span);
      }
    }
    lastValueRef.current = value;
  }, [value, fileBlocks]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const newValue = domToValue(el);
    lastValueRef.current = newValue;

    // Detect removed paste blocks (blocks in state but no longer in DOM)
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

    // Detect removed file blocks
    const currentFileIds = new Set<string>();
    el.querySelectorAll("[data-file-id]").forEach((n) => {
      const id = (n as HTMLElement).dataset.fileId;
      if (id) currentFileIds.add(id);
    });
    for (const file of fileBlocksRef.current) {
      if (!currentFileIds.has(file.id)) {
        onRemoveFileBlock?.(file.id);
      }
    }

    onChange(newValue);
  }, [onChange, onRemoveBlock, onRemoveFileBlock]);

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
    span.textContent = `📎 ${lineCount} lines`;

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

  const insertFileBlock = useCallback((file: FileBlock) => {
    const el = editorRef.current;
    if (!el) return;
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.fileId = file.id;
    span.className = "inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 mx-0.5 text-[11px] text-primary font-mono select-none align-middle cursor-default";
    span.title = `${file.filename} • ${formatBytes(file.size)}`;
    span.textContent = `📄 ${file.filename} (${formatBytes(file.size)})`;

    const selection = window.getSelection();
    const editorContains = selection && selection.rangeCount > 0 && el.contains(selection.anchorNode);
    if (editorContains) {
      const range = selection!.getRangeAt(0);
      range.deleteContents();
      range.insertNode(span);
      range.setStartAfter(span);
      range.setEndAfter(span);
      selection!.removeAllRanges();
      selection!.addRange(range);
    } else {
      el.appendChild(span);
    }

    setTimeout(() => {
      const newValue = domToValue(el);
      lastValueRef.current = newValue;
      onChange(newValue);
    }, 0);
  }, [onChange]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (!onFileSelect) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const block = await onFileSelect(file);
        if (block) insertFileBlock(block);
      }
    } finally {
      setUploading(false);
    }
  }, [onFileSelect, insertFileBlock]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [disabled, handleFiles]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    // Reset so re-selecting the same file fires onChange again
    e.target.value = "";
  }, [handleFiles]);

  const isEmpty = !value || value.length === 0;

  return (
    <div className="relative flex-1 min-w-0">
      {isEmpty && placeholder && (
        <div className="pointer-events-none absolute left-4 top-3 text-sm text-muted-foreground">
          {placeholder}
        </div>
      )}
      {onFileSelect && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={disabled || uploading}
            title={uploading ? "Uploading..." : "Attach a file"}
            className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-secondary-foreground/10 hover:text-foreground disabled:opacity-50"
          >
            {uploading ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
        </>
      )}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={onKeyDown}
        onDragOver={(e) => { if (onFileSelect) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "w-full h-full min-h-full resize-none overflow-y-auto rounded-lg border bg-secondary px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring whitespace-pre-wrap break-words",
          onFileSelect && "pr-9",
          dragOver && "ring-2 ring-primary/60 bg-primary/5",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        style={{ minHeight: "100%" }}
      />
    </div>
  );
});
