# CLAUDE.md

pidex is an Electron desktop app that wraps the **pi coding agent**
(`@earendil-works/pi-coding-agent`) — one `pi --mode rpc` subprocess per live
session, spoken to over JSONL on stdio. pidex never imports pi's code; the
protocol is hand-mirrored in `shared/rpc.ts`. Product/domain specs live in
`specs/` (per-domain specs, `TRACKER.md` for phase status, `specs/log/` for
dated write-ups of individual changes, `specs/archive/` for landed plans).

## Commands

```bash
npm run dev        # Electron + Vite with HMR (needs pi on PATH; see below)
npm run typecheck  # tsc for main (tsconfig.node) + renderer (tsconfig.web)
npm run lint       # eslint
npm run format     # prettier --write
npm test           # vitest unit tests
npm run test:e2e   # builds, then Playwright-Electron against the pi stub
npm run validate   # all of the above, quiet: PASS/FAIL summary + a log file
```

CI runs typecheck, lint, `prettier --check .`, unit tests, build, and the e2e
matrix (ubuntu + macOS). Run typecheck + lint + test before considering a
change done; run e2e when touching IPC, session lifecycle, or visible UI flow.

`npm run validate` (`scripts/validate.sh`) is the one to reach for when you
just want a verdict: it prints one line per step and sends everything else to
`$VALIDATE_LOG` (default `/tmp/pidex-validate-$$.log`). `SKIP_E2E=1` stops
before the slow part.

**E2E windows never appear on your screen**, so a background agent running the
suite can't steal focus mid-keystroke. `scripts/e2e.sh` prefers `xvfb-run`
(real windows on a virtual display, full speed — install with
`sudo apt install xvfb`) and otherwise leaves the windows unmapped
(`hideWindowsForE2E` in `electron/window-chrome.ts`), which is ~2-3x slower
because Chromium deprioritizes rendering for a window that was never shown.
`PIDEX_E2E_SHOW=1 npm run test:e2e` puts them back on your real display when
you want to watch.

## Architecture in five facts

1. **The main process owns all side effects.** The renderer runs sandboxed
   (contextIsolation, no Node) and is pure UI over typed IPC. If a feature
   needs disk/network/subprocess, it goes in `electron/`, not `src/`.
2. **IPC is a typed contract.** A new channel = an entry in
   `shared/ipc.ts` `IpcInvokeMap` + a handler in
   `electron/ipc/<prefix>-handlers.ts` (module matches the channel prefix:
   `pi:`, `app:`, `sessions:`, `git:`, `fs:`, `pty:`) + a case in
   `src/dev/mockPidex.ts` if the browser harness should exercise it.
   `electron/ipc.ts` is only the composition root; the session registry lives
   in `electron/registry.ts` so handlers never import their composition root.
3. **RPC to pi goes through `src/lib/rpc.ts`** (`piCall` / `piCallOk`), which
   unwraps the `{success, data?, error?}` envelope and surfaces failures on
   the session's chat. Calling `window.pidex.piCommand` directly means you own
   the error branch — half the original call sites forgot, so don't.
4. **`shared/rpc.ts` is a mirror of pi's protocol** with compile-time drift
   guards (`_NoMissingResponseKeys` / `_NoExtraResponseKeys`). Adding an RPC
   command means updating both the command union and `RpcResponseDataMap`, or
   it won't compile — that's intentional.
5. **Stores (`src/stores/`, zustand) are projections of main-process state.**
   `files.ts` and `terminal.ts` are keyed `byWorkspace[path]`; their
   `workspaceFiles()` / `workspaceTerminals()` selectors return a shared
   frozen empty value — never mutate it, never inline a fresh `{}` in a
   selector. "Which workspace am I in?" is `useActiveWorkspace()` (derived,
   prefers the active session's own cwd) — not a global current-workspace.

## Sharp edges (read before touching)

- **`electron/pi/session-writer.ts` appends to pi's own session files**
  (bookmarks, branch jumps, forks). It is only safe while no pi process owns
  the file — call sites enforce this by convention. It depends on pi's on-disk
  format staying stable. Tests: `electron/pi/__tests__/session-writer.test.ts`.
- **JSONL framing is strict LF via `JsonlDecoder`, never `readline`** —
  U+2028/U+2029 are legal inside JSON strings and readline splits on them.
- **`electron/pi/pi-paths.ts` is the single source of truth** for pi's session
  directory layout and cwd mangling (`realpathSync.native` first — pi resolves
  symlinks). The e2e stub duplicates the mangling in
  `e2e/fixtures/pi-stub.cjs`; keep them in sync.
- **`electron/store.ts` constructs its electron-store lazily on purpose** —
  a module-scope `new Store()` would resolve `userData` before main.ts can
  redirect it for E2E, leaking test state into real prefs.
- **E2E env hooks (`PIDEX_PI_STUB`, `PIDEX_E2E_WORKSPACE`,
  `PIDEX_TEST_USER_DATA`) must stay gated on `!app.isPackaged`.** Ungated,
  they are env-var-triggered code execution in the main process of a shipped
  app (fixed once; don't regress it).
- **`bootstrapSession` learns a session's file path asynchronously** (from
  `get_state`), so last-session persistence happens in two places in
  `src/stores/sessions.ts` — read the comments there before "simplifying".
- Session-dir watchers are per-workspace chokidar handles tied to sidebar
  group visibility (expanded ⇒ watched, collapsed ⇒ unwatched, all closed on
  quit). Don't add unbounded watch paths.
- **Not every session was produced by a pi-native provider.** Sessions run on
  the Claude Code provider (`@saccolabs/pi-claude-cli`) contain block shapes
  pi itself never emits: CLI-side tools arrive as `[Claude Code · Name {…}]`
  marker text blocks (a wire contract — `parseExternalToolMarker` turns them
  into activity steps), and some models emit thinking with a signature and no
  plaintext. Before touching transcript rendering, tool UX or subagent UI,
  read [specs/12-extensions.md](specs/12-extensions.md#how-provider-transcripts-render).
- **`pi-ext/worktree-paths.ts` can refuse a tool call**, and it is the only
  pidex code that runs inside pi's process. It blocks a `read`/`write`/`edit`/
  `ls`/`grep`/`find` whose path escapes a worktree session into the repo's main
  checkout (a different branch) when the same file exists in the worktree —
  models were doing this silently and answering about the wrong branch. The
  four conditions in that file are deliberately narrow; widening them blocks
  legitimate reads, because pi's own prompt sends the model to absolute paths
  outside the cwd for its docs. See
  [specs/log/2026-08-22-worktree-path-leak.md](specs/log/2026-08-22-worktree-path-leak.md).
- **Two UI surfaces are fed by extensions, not by RPC.** The context meter's
  composition section comes from `pi-ext/context-breakdown.ts` (bundled, `-e`
  into every session) and its plan-limits section from the Claude provider
  package — both over `ctx.ui.setStatus` into `stores/extensionUi.ts`. The
  second crosses a repo boundary, so nothing here fails to compile when it
  changes; the keys and their rules are in
  [specs/12-extensions.md](specs/12-extensions.md#the-status-channel-is-a-wire-contract).
  Component sizes in that breakdown are estimates and must stay labelled as
  such — only pi's total is authoritative.

## Conventions

- Tests live beside their subject as `*.test.ts`; DOM suites opt in per file
  with `// @vitest-environment jsdom`. Prefer testing pure logic extracted
  into `src/lib/` / plain modules over component tests.
- Modals use `ModalOverlay` from `src/components/Modal.tsx` — portalling,
  backdrop dismissal, and depth-aware Escape (innermost wins). Don't add
  window-level Escape listeners in modal content.
- Model-authored HTML renders **only** inside a sandboxed iframe under the
  strict CSP. Never widen this.
- Renderer path aliases: `@/` → `src/`, `@shared/` → `shared/`.
- Browser-only dev (vite without Electron) auto-installs
  `src/dev/mockPidex.ts` when `window.pidex` is undefined — new IPC channels
  used by screens the harness renders need a mock case.
- When you ship a substantial feature or refactor: if it advances a numbered
  phase, add a dated note to that phase's Log in `specs/TRACKER.md`; otherwise
  write it up as its own `specs/log/YYYY-MM-DD-slug.md` (the existing files
  show the convention). Never append a new section to `TRACKER.md` — a shared
  append point is what used to make unrelated PRs conflict. Also update any
  plan doc in `specs/` you implemented or deviated from. The specs drifting
  from the code is a recurring failure mode here.

## Running the app

`npm run dev` requires `pi` on PATH (`npm i -g @earendil-works/pi-coding-agent`,
Node ≥ 22.19). Without it the app boots to the "pi missing" setup screen —
still useful for shell/UI work. For pure renderer work, `npm run dev:web` in
the browser uses the mock API (plain `vite` reads the root `vite.config.ts`,
which mirrors the `renderer` block of `electron.vite.config.ts` — keep the two
in sync). The `/run` and `/e2e` skills cover both flows.
