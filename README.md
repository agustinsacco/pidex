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

### Architecture

```
electron/          main process — pi RPC clients, PTYs, fs/git, watchers, prefs
  ipc.ts           composition root: calls the per-domain handler registrars
  ipc/             one module per IPC channel prefix (pi, app, sessions, git, fs, pty)
  registry.ts      the live pi session registry
  pi/              PiRpcClient (strict LF JSONL framing), session scanner/writer
  pty/             node-pty manager
  fs/              file service, git service, workspace watcher
shared/            types shared by main + renderer (ipc, rpc, models)
src/               renderer (React) — pure UI over typed IPC
  components/      cross-feature primitives (Modal, icons, form fields)
  features/        chat, files, terminal, artifacts, sessions, settings, palette
  lib/             framework-free helpers (format, path, rpc, base64, fuzzy, time)
  stores/          zustand stores (projections of main-process state)
pi-ext/            bundled pi extension (artifacts tools)
e2e/               Playwright-Electron smoke tests + deterministic pi stub
specs/             product and domain specifications
```

Conventions worth knowing:

- **IPC handlers** live in `electron/ipc/<domain>-handlers.ts`; a new channel
  goes in the module matching its prefix.
- **RPC calls from the renderer** go through `src/lib/rpc.ts` (`piCall` /
  `piCallOk`), which reports failures on the session's chat surface. Calling
  `window.pidex.piCommand` directly means handling the error envelope yourself.
- **Modals** use `ModalOverlay` from `src/components/Modal.tsx` for portalling,
  backdrop dismissal and depth-aware Escape (innermost modal wins).
- **Tests** live beside their subject as `*.test.ts`. DOM-dependent suites opt
  in per file with `// @vitest-environment jsdom`.

The main process owns all side effects. The renderer runs with
`contextIsolation`, no Node integration, and a strict CSP; model-authored HTML
only ever renders inside a sandboxed iframe.

## License

MIT
