# 01 — Architecture

## Locked technical decisions

| Area                 | Decision                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Shell                | Electron (current stable), TypeScript everywhere, strict mode                                    |
| Renderer             | React 18+, Vite, Tailwind CSS                                                                    |
| State                | Zustand (per-domain stores); no Redux                                                            |
| Code viewing/editing | Monaco Editor (also provides the diff editor)                                                    |
| Terminal             | xterm.js + node-pty (real PTY, user shell, full interactivity)                                   |
| Markdown             | Streaming-tolerant pipeline (react-markdown + remark-gfm class) with Shiki or highlight.js       |
| Diagrams             | Mermaid, client-side                                                                             |
| Math                 | KaTeX                                                                                            |
| Charts               | Fenced chart specs (`vega-lite / `chart JSON) via vega-lite or Chart.js                          |
| HTML preview         | Sandboxed `<iframe sandbox>`, Code/Preview toggle                                                |
| File watching        | chokidar (main process)                                                                          |
| Packaging            | electron-builder → macOS (dmg+zip, arm64+x64), Linux (AppImage+deb), Windows (nsis)              |
| Install              | GitHub Releases + `curl … install.sh \| sh` (see [10-packaging.md](specs/build/10-packaging.md)) |
| IPC                  | Typed contextBridge preload; renderer never touches Node APIs                                    |
| pi integration       | RPC subprocess, one `pi --mode rpc` per live session ([02-pi-integration.md](pi-integration.md)) |

## Process model

```
┌────────────────────────── Electron main ──────────────────────────┐
│  WorkspaceManager   SessionManager     PtyManager    FsService    │
│        │              │        │            │            │        │
│        │        PiRpcClient (1 per live session)    chokidar      │
│        │              │  spawn: pi --mode rpc                     │
└────────┼──────────────┼─────────────────────┼─────────────────────┘
         │   typed IPC (contextBridge preload; per-session channels)
┌────────┴──────────────┴─────────────────────┴─────────────────────┐
│                      Renderer (React, sandboxed)                  │
│  Zustand stores: workspaces / sessions / chat / files / terminal  │
│                  / artifacts / settings / layout                  │
└───────────────────────────────────────────────────────────────────┘
```

- **Main process owns all side effects**: pi subprocesses, PTYs, filesystem, git, watchers, dialogs, app prefs.
- **Renderer is pure UI** over typed IPC. `contextIsolation: true`, `nodeIntegration: false`, sandbox on, strict CSP. Model-authored HTML renders only in the sandboxed iframe.
- **IPC design**: request/response methods (`invoke`) for commands, push channels (`send`) for streams. Namespace per domain, 11 prefixes today: `pi:*` (session lifecycle + RPC passthrough + event stream), `sessions:*`, `pty:*`, `fs:*`, `git:*`, `gh:*`, `mcp:*`, `clipboard:*`, `packages:*`, `updates:*`, `app:*` (prefs, dialogs, theme). Every message type is declared in [`shared/ipc.ts`](../shared/ipc.ts).
- **Data flow for one streamed prompt**: renderer `pi:prompt` → main writes JSONL line to child stdin → child stdout events parsed by PiRpcClient → forwarded on `pi:event:<sessionId>` → chat store reduces events into message view-models → virtualized list renders deltas.

## Repo layout

**See the tree in [the README](../README.md#repo-layout).** It used to be
duplicated here; the copy drifted (it named a `types/ipc.ts` that never existed,
listed 6 of 13 feature folders, and 2 of 5 pi extensions), so this section is a
pointer now.

## Cross-cutting requirements

- Single source of truth for session state lives in main (registry of live sessions ↔ pi children); renderer stores are projections.
- All long/streaming output is incrementally reduced — never rebuild whole message arrays per delta.
- Every feature works on macOS, Linux, Windows (path handling via `node:path`, PTY shells per-OS: `$SHELL` / PowerShell).
- App prefs (theme, layout, workspaces, font size) in electron-store — never written into pi's config files. pi config editing is explicit and user-initiated ([09-settings.md](settings.md)).
