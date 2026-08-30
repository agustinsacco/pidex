<picture>
  <source media="(prefers-color-scheme: dark)" srcset="build/icon.svg">
  <source media="(prefers-color-scheme: light)" srcset="build/icon-light.svg">
  <img src="build/icon.svg" alt="pidex" width="88" height="88">
</picture>

# pidex

A desktop coding-agent app for macOS, Linux and Windows, powered entirely by the
[pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

Open a project folder, describe a task, and work alongside the agent: rich chat
(markdown, diffs, diagrams, charts, sandboxed HTML previews), a file explorer with
a Monaco editor, reviewable diffs of everything the agent changed, a real terminal,
and a versioned artifacts panel.

## Install

macOS and Linux:

```bash
curl -fsSL https://github.com/agustinsacco/pidex/releases/latest/download/install.sh | sh
```

The script installs the AppImage on Linux and the `.app` bundle on macOS,
verifying the download against the release's `checksums.txt`.

Windows builds are produced by the tagged `Release` workflow rather than the
per-merge one, so a `.exe` is only present on releases that were cut from a
`v*` tag.

pidex needs `pi` on your PATH:

```bash
npm install -g @earendil-works/pi-coding-agent
```

The app shows a setup screen until pi is available. Sign in to a provider by
running `pi` in pidex's built-in terminal and using `/login`, or configure API
keys / a local endpoint in `~/.pi/agent/`.

### Updates

Every merge to `main` that passes CI publishes a new release, versioned
`0.1.<commit count>`. An installed app checks for one at launch and every 30
minutes after; when it finds one, an update button appears in the sidebar
footer, just above Settings.

Linux AppImage and signed macOS installs download in the background and offer
"Restart to update". Unsigned macOS and `.deb` installs cannot replace their
own files, so they link to the release page instead. Update checks are
disabled entirely in development builds — they only run when packaged.

## What it does

- **Sessions are real pi subprocesses.** One `pi --mode rpc` per live session,
  spawned in the workspace folder. Everything pi exposes over RPC is reachable
  from the UI — models, thinking levels, steering and follow-up queues,
  compaction, auto-retry, forks, clones, session export.
- **No permission prompts.** pi runs in full-permission mode; tool calls execute
  and stream their results.
- **Rich responses are first-class.** GFM markdown, syntax-highlighted code,
  mermaid diagrams, Chart.js and Vega-Lite specs, KaTeX math, and model-authored
  HTML rendered in a sandboxed iframe.
- **Every change is reviewable.** The Changes panel accumulates the agent's
  edits with per-file diffs against a session baseline, and per-file revert.
- **Session tree.** Visualize the branch structure of a session, jump to any
  point, fork from it, or bookmark it.
- **Artifacts.** A bundled pi extension adds `artifact_create` / `artifact_update`
  tools; substantial deliverables land in a versioned side panel with previews
  and diffs between versions, and survive app restarts via session replay.

## Development

Requires Node 22+ (pi itself requires Node ≥ 22.19).

```bash
npm install
npm run dev
```

| Script              | Purpose                                               |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Electron + Vite dev server with HMR                   |
| `npm run typecheck` | TypeScript project checks (main + renderer)           |
| `npm run lint`      | ESLint                                                |
| `npm test`          | Vitest unit tests                                     |
| `npm run test:e2e`  | Playwright-Electron smoke tests                       |
| `npm run dist`      | Package for the current platform via electron-builder |

### Repo layout

This tree is the single source of truth for "what lives where". `CLAUDE.md` and
[docs/architecture.md](docs/architecture.md) link here
rather than keeping their own copies — there used to be three, and all three had
drifted.

```
electron/            main process — owns every side effect
  main.ts            app lifecycle, window creation, quit teardown
  preload.ts         the contextBridge surface (one typed `subscribe` helper)
  ipc.ts             composition root: calls the per-domain handler registrars
  ipc/               one module per IPC channel prefix — 14 of them today
                     (pi, app, sessions, fleet, git, gh, fs, pty, mcp,
                      clipboard, packages, claude, orchestrator, updates)
  registry.ts        the live pi session registry
  pi/                RPC client (strict LF JSONL framing), session scanner,
                     writer, paths, print mode, model catalogue, login flow
  pty/               node-pty manager + spawn-helper repair
  fs/                file service, git layer (git-exec/info/sync/worktrees),
                     workspace watcher
  orchestrator/      the per-project orchestrator session and the fleet hub
  updates/           update check + download state machine
  store.ts           app prefs (electron-store, constructed lazily)
shared/              types and pure logic shared by main + renderer
  ipc.ts             the typed IpcInvokeMap contract
  rpc.ts             hand-mirrored copy of pi's RPC protocol + drift guards
  models.ts          model catalogue and orchestration types
src/                 renderer (React) — pure UI over typed IPC
  app/               shell: App, TopBar, workspace picker, global shortcuts
  features/          one folder per surface: chat, sessions, files, terminal,
                     artifacts, settings, home, orchestrator, worktrees,
                     workspaces, palette, updates, extension-ui
  components/        cross-feature primitives (Modal, PopupMenu, form, icons,
                     markdown renderers)
  stores/            zustand stores — projections of main-process state
  lib/               framework-free helpers (format, path, rpc, fuzzy, time…)
  styles/            the Phosphor design tokens
  dev/               browser-only mock of the preload API (never bundled)
pi-ext/              five pi extensions that run inside pi's process:
                     artifacts, context-breakdown, worktree-paths,
                     tool-name-guard (bundled into every session) and
                     orchestrator (orchestrator sessions only)
e2e/                 Playwright-Electron smoke tests + deterministic pi stub
scripts/             install.sh, icon generation, release + validate helpers
docs/                how pidex works now; docs/log dated history;
                     docs/specs deferred work — see docs/README.md
```

The main process owns all side effects. The renderer runs with
`contextIsolation`, no Node integration, and a strict CSP; model-authored HTML
only ever renders inside a sandboxed iframe.

**Conventions** (IPC channels, the `piCall` rule, modals, tests, and the sharp
edges worth knowing before you touch pi's session files) live in
[CLAUDE.md](CLAUDE.md). It is written for coding agents but it is the shortest
accurate orientation for a human too.

## License

MIT
