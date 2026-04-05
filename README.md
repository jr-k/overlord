# Overlord

A local web-based project multiplexer with integrated Claude AI agents. Manage multiple projects, chat with Claude in the context of each project, track todos, and run terminals — all from one interface.

## Features

- **Multi-project management** — Scan a directory for git repos, switch between them instantly
- **Claude AI chat per project** — Chat with Claude scoped to each project's codebase, with streaming responses and tool access
- **Todos / Backlog** — Track ideas and tasks per project, launch them directly into the chat
- **Integrated terminal** — Run commands in each project's directory, with tab completion and multi-tab support
- **Monorepo support** — Detect and display workspace packages (pnpm, yarn, npm workspaces, nx, lerna)
- **Persistent state** — Chat history, todos, and project settings survive server restarts (SQLite)
- **MCP server** — Claude agents can read/write todos via the Overlord MCP protocol
- **Auto-summaries** — Project summaries generated automatically after each conversation

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick Start

```bash
# Clone the repo
git clone https://github.com/poptocrack/overlord.git
cd overlord

# Install dependencies
npm install

# Start the dev server (backend + frontend)
npm run dev

# Open http://localhost:4748 in your browser
```

On first launch, click **"Scanner les projets"** in the sidebar to detect git repositories.

## Configuration

### Root Directory

By default, Overlord scans the **parent directory** of where the server is running. To scan a different directory:

```bash
OVERLORD_ROOT=/path/to/your/projects npm run dev
```

For example:
```bash
# Scan ~/Projects instead of the default
OVERLORD_ROOT=~/Projects npm run dev
```

### Port

The backend runs on port `4747` and the frontend dev server on `4748`. To change:

```bash
PORT=5000 npm run dev
```

### Claude CLI Path

If `claude` is not in your PATH:

```bash
CLAUDE_PATH=/path/to/claude npm run dev
```

## Project Structure

```
overlord/
├── server/                # Backend (Hono + SQLite)
│   ├── index.ts           # Main server, WebSocket, agent management
│   ├── mcp.ts             # MCP server for Claude tool integration
│   ├── workspaces.ts      # Monorepo workspace detection
│   ├── db/
│   │   ├── schema.ts      # Drizzle ORM schema
│   │   └── index.ts       # SQLite init + migrations
│   └── routes/
│       ├── projects.ts    # Project CRUD + git scan
│       ├── sessions.ts    # Session history
│       ├── conversations.ts # Chat conversations
│       └── todos.ts       # Todo CRUD
├── src/                   # Frontend (React + Vite + shadcn/ui)
│   ├── App.tsx            # Main layout
│   ├── components/
│   │   ├── Sidebar.tsx    # Project list with favorites/search
│   │   ├── ChatTab.tsx    # Claude chat with streaming
│   │   ├── TodosTab.tsx   # Todo management
│   │   ├── TerminalTab.tsx # Integrated terminal
│   │   ├── SummaryTab.tsx # Project summary
│   │   ├── WorkspacesTab.tsx # Monorepo workspace view
│   │   └── TimelineTab.tsx
│   ├── hooks/
│   └── types.ts
├── bin/overlord.js        # CLI entry point
└── package.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, Tailwind CSS v4, shadcn/ui |
| Backend | Hono, Node.js |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| AI | Claude Code CLI (`--print --output-format stream-json`) |
| Protocol | WebSocket (chat streaming, terminal), MCP |

## Scripts

```bash
npm run dev          # Start backend + frontend (hot reload)
npm run dev:server   # Backend only (with watch)
npm run dev:client   # Frontend only
npm run build        # Production build
```

## Data Storage

All data is stored in `~/.overlord/overlord.db` (SQLite). This includes:
- Project registry (scan results, favorites, hidden state)
- Chat conversations and messages
- Todos
- Auto-generated summaries

The database is created automatically on first run.

## License

MIT
