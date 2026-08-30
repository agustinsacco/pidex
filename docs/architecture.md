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

Three kinds of process. The main process owns every side effect; the renderer
is pure UI over a typed bridge; pi and the user's shell run as children.

```mermaid
graph TB
  subgraph REN["Renderer — sandboxed React, no Node"]
    ST["Zustand stores<br/>sessions · chat · files · terminal · artifacts · settings · layout"]
    WRAP["src/lib/rpc.ts<br/>piCall / piCallOk"]
  end

  subgraph PRE["preload — contextBridge"]
    API["window.pidex<br/>130 invoke channels · 15 prefixes"]
  end

  subgraph MAIN["Electron main — owns all side effects"]
    ROOT["ipc.ts<br/>composition root only"]
    HAND["electron/ipc/*-handlers.ts<br/>14 modules, one per prefix"]
    REG["registry.ts<br/>SessionRegistry + FleetHub"]
    CLIENT["PiRpcClient<br/>one per live session"]
    PTYM["PtyManager"]
    DISK["chokidar watchers · git · fs · electron-store"]
  end

  subgraph CHILD["Child processes"]
    PI["pi --mode rpc<br/>one per LIVE session"]
    SHELL["user shell via node-pty"]
  end

  ST --> WRAP --> API --> ROOT --> HAND
  HAND --> REG --> CLIENT
  HAND --> PTYM
  HAND --> DISK
  CLIENT -->|"JSONL over stdio"| PI
  PTYM --> SHELL
  CLIENT -.->|"push on pi:event:sessionId"| ST
```

- **Main owns all side effects**: pi subprocesses, PTYs, filesystem, git,
  watchers, dialogs, app prefs. A feature needing any of those lives in
  `electron/`, not `src/`.
- **Renderer is pure UI.** `contextIsolation: true`, `nodeIntegration: false`,
  sandbox on, strict CSP. Model-authored HTML renders only in the sandboxed
  iframe served over `pidex-artifact://`.
- **`registry.ts` is deliberately not `ipc.ts`.** The handler modules need the
  live-session registry, and importing their own composition root to get it
  would be a cycle.
- **Idle sessions are not processes.** The sidebar is built by scanning pi's
  session files on disk; only a session you have open holds a subprocess.

### The IPC surface

Request/response uses `invoke`; streams are pushed from main. Every channel is
declared in [`shared/ipc.ts`](../shared/ipc.ts) — 130 invoke channels across 15
prefixes, each backed by the handler module matching its prefix.

| Prefix        | Ch. | Prefix        | Ch. | Prefix           | Ch. |
| ------------- | --- | ------------- | --- | ---------------- | --- |
| `app:*`       | 28  | `git:*`       | 19  | `pi:*`           | 20  |
| `sessions:*`  | 10  | `mcp:*`       | 10  | `orchestrator:*` | 9   |
| `fs:*`        | 9   | `packages:*`  | 7   | `pty:*`          | 5   |
| `claude:*`    | 4   | `gh:*`        | 3   | `updates:*`      | 3   |
| `artifacts:*` | 1   | `clipboard:*` | 1   | `fleet:*`        | 1   |

Push channels are the exception to request/response: `pi:event:<sessionId>`
(per live session, built by `sessionEventChannel`), plus `fleet:state`,
`updates:state` and `updates:event`.

### One streamed prompt, end to end

The response to `prompt` and the stream it produces are two different
mechanisms. The command is correlated by `id` and resolves once; the turn's
content arrives afterwards as uncorrelated events.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant S as Chat store
  participant B as preload bridge
  participant H as pi-session-handlers
  participant C as PiRpcClient
  participant P as pi --mode rpc

  U->>S: submit prompt
  S->>B: piCommand sessionId, prompt
  B->>H: invoke pi:command
  H->>C: request command
  Note over C: assigns id px-N and<br/>stores it in the pending map
  C->>P: one JSON line + LF on stdin
  P-->>C: response echoing id px-N
  C-->>H: resolves pending px-N
  H-->>S: envelope success, data
  Note over S: piCall unwraps it —<br/>a failure lands on the session chat

  loop until turn ends
    P-->>C: event lines, never carrying an id
    C-->>S: push on pi:event:sessionId
    S->>S: reduce delta into the message view-model
  end
  Note over P: pi writes the session file<br/>only now, at turn end
```

Two consequences worth holding onto:

- **A protocol error is data, not an exception.** `request()` resolves with
  `{success: false}` and rejects only when the transport is broken. That is why
  every renderer call goes through `piCall`/`piCallOk` — calling
  `window.pidex.piCommand` directly means owning the error branch, and half the
  original call sites forgot.
- **Nothing reaches disk mid-turn.** A name set during a turn is not in the
  session file until the reply lands, so every surface showing a live session's
  title prefers the chat store over the disk scan.

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
