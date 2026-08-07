# CLAUDE.md

pidex is an Electron desktop app that wraps the **pi coding agent**
(`@earendil-works/pi-coding-agent`) — one `pi --mode rpc` subprocess per live
session, spoken to over JSONL on stdio. pidex never imports pi's code; the
protocol is hand-mirrored in `shared/rpc.ts`. Product/domain specs live in
`specs/` (per-domain specs + `TRACKER.md` for phase status).

## Commands

```bash
npm run dev        # Electron + Vite with HMR (needs pi on PATH; see below)
npm run typecheck  # tsc for main (tsconfig.node) + renderer (tsconfig.web)
npm run lint       # eslint
npm run format     # prettier --write
npm test           # vitest unit tests
npm run test:e2e   # builds, then Playwright-Electron against the pi stub
```

CI runs typecheck, lint, `prettier --check .`, unit tests, build, and the e2e
matrix (ubuntu + macOS). Run typecheck + lint + test before considering a
change done; run e2e when touching IPC, session lifecycle, or visible UI flow.

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
- When you ship a substantial feature or refactor, add a dated log entry to
  `specs/TRACKER.md` (the P0–P7 sections show the convention) and update any
  plan doc in `specs/` you implemented or deviated from. The specs drifting
  from the code is a recurring failure mode here.

## Running the app

`npm run dev` requires `pi` on PATH (`npm i -g @earendil-works/pi-coding-agent`,
Node ≥ 22.19). Without it the app boots to the "pi missing" setup screen —
still useful for shell/UI work. For pure renderer work, `npx vite dev` in the
browser uses the mock API. The `/run` and `/e2e` skills cover both flows.
