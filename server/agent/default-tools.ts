// The default allowlist for an agent when a project has no custom `allowedTools`.
// Kept in one place so the chat runner and the tool-request approval flow agree
// on what "the defaults" are (approving a tool must not silently drop them).
export const DEFAULT_ALLOWED_TOOLS = [
  "Edit", "Write", "Read", "Bash", "Glob", "Grep", "NotebookEdit",
  "WebFetch", "WebSearch", "ToolSearch", "Agent",
  "mcp__overlord__overlord_list_todos", "mcp__overlord__overlord_add_todo",
  "mcp__overlord__overlord_complete_todo", "mcp__overlord__overlord_delete_todo",
  "mcp__overlord__overlord_list_projects", "mcp__overlord__overlord_get_project",
  "mcp__overlord__overlord_ask_project", "mcp__overlord__overlord_request_tool",
];
