# Contributing to Overlord

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/overlord.git
cd overlord
npm install
npm run dev
```

This starts both the backend (port 4747, hot reload via `tsx watch`) and frontend (port 4748, Vite HMR).

### Prerequisites

- Node.js >= 18
- Claude Code CLI installed and authenticated (`claude --version` should work)

## How to Contribute

### Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, Claude Code version)

### Suggesting Features

Open an issue with the `enhancement` label. Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Submitting Changes

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Ensure TypeScript compiles cleanly: `npx tsc --noEmit`
5. Test manually (automated tests coming soon)
6. Commit with a clear message
7. Open a PR against `main`

## Architecture Overview

### Backend (`server/`)

- **Hono** HTTP server with REST API routes
- **WebSocket** on `/ws` — multiplexed for chat streaming and terminal sessions
- **Agent sessions** — one Claude process per project, managed in memory, events persisted to SQLite
- **Terminal sessions** — shell commands via `child_process.spawn`, survive WebSocket reconnects
- **MCP server** (`server/mcp.ts`) — exposes todos as MCP tools for Claude agents

### Frontend (`src/`)

- **React + Vite + Tailwind v4 + shadcn/ui** (base-nova style)
- Tabs per project: Chat, Todos, Workspaces, Summary, Terminal, Timeline
- Chat uses WebSocket for real-time streaming
- State persisted via localStorage (selected project, active tab) + backend SQLite (conversations, todos)

### Database

SQLite at `~/.overlord/overlord.db`. Schema managed via Drizzle ORM with inline migrations in `server/db/index.ts`.

Tables: `projects`, `conversations`, `messages`, `sessions`, `todos`

## Code Style

- TypeScript strict mode
- No CSS-in-JS — use Tailwind classes and shadcn/ui components
- Prefer shadcn/ui components over custom UI
- Keep components focused — one file per tab/feature

## Areas That Need Help

- [ ] Automated tests (none currently)
- [ ] Edit validation (show diffs before Claude writes files)
- [ ] Desktop notifications when an agent finishes
- [ ] Cost tracking (data is in stream-json events, needs UI)
- [ ] Git integration (status, commits, branches in project view)
- [ ] True PTY terminal (blocked by node-pty + Node 22 incompatibility)
