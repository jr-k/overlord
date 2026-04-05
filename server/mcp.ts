#!/usr/bin/env node
/**
 * Overlord MCP Server
 *
 * Exposes Overlord's features (todos, project info) as MCP tools
 * so Claude agents can interact with them natively.
 *
 * Communicates with the Overlord HTTP API running on localhost.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OVERLORD_PORT = process.env.OVERLORD_PORT || "4747";
const BASE = `http://localhost:${OVERLORD_PORT}/api`;

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return res.json();
}

const server = new McpServer({
  name: "overlord",
  version: "0.1.0",
});

// ─── Todo Tools ──────────────────────────────────────────────

server.tool(
  "overlord_list_todos",
  "List all todos for a project. Returns pending and done todos.",
  { projectId: z.number().describe("The project ID") },
  async ({ projectId }) => {
    const todos = await api(`/todos/${projectId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(todos, null, 2) }],
    };
  }
);

server.tool(
  "overlord_add_todo",
  "Add a new todo/task to a project's backlog. Use this when you identify work to be done, features to add, bugs to fix, or improvements to make.",
  {
    projectId: z.number().describe("The project ID"),
    title: z.string().describe("Short title for the todo"),
    description: z.string().optional().describe("Longer description with details, acceptance criteria, etc."),
  },
  async ({ projectId, title, description }) => {
    const todo = await api("/todos", {
      method: "POST",
      body: JSON.stringify({ projectId, title, description }),
    });
    return {
      content: [{ type: "text", text: `Todo created: [${todo.id}] ${todo.title}` }],
    };
  }
);

server.tool(
  "overlord_complete_todo",
  "Mark a todo as done. Use this after you've finished implementing a task.",
  { todoId: z.number().describe("The todo ID to mark as complete") },
  async ({ todoId }) => {
    const todo = await api(`/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
    return {
      content: [{ type: "text", text: `Todo completed: ${todo.title}` }],
    };
  }
);

server.tool(
  "overlord_delete_todo",
  "Delete a todo that is no longer relevant.",
  { todoId: z.number().describe("The todo ID to delete") },
  async ({ todoId }) => {
    await api(`/todos/${todoId}`, { method: "DELETE" });
    return {
      content: [{ type: "text", text: `Todo ${todoId} deleted.` }],
    };
  }
);

// ─── Project Tools ───────────────────────────────────────────

server.tool(
  "overlord_list_projects",
  "List all projects tracked by Overlord.",
  {},
  async () => {
    const projects = await api("/projects");
    const summary = projects.map((p: any) =>
      `[${p.id}] ${p.name} (${p.favorite ? "★ " : ""}${p.hidden ? "hidden" : "active"})`
    ).join("\n");
    return {
      content: [{ type: "text", text: summary || "No projects found." }],
    };
  }
);

server.tool(
  "overlord_get_project",
  "Get details about a specific project including its summary.",
  { projectId: z.number().describe("The project ID") },
  async ({ projectId }) => {
    const project = await api(`/projects/${projectId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[overlord-mcp] server started");
}

main().catch((err) => {
  console.error("[overlord-mcp] fatal:", err);
  process.exit(1);
});
