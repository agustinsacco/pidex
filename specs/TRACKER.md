# pidex — Build Tracker

**How to use this file (executing agent, read this first):**
- Work phases in order. Each phase must end **runnable** (`npm run dev` launches, prior features still work) before its status flips to ✅.
- Update this file as you go: flip task checkboxes the moment a task is done; set phase status (⬜ todo → 🟡 in progress → ✅ done); add a dated one-line note under each phase's **Log** when you complete it or hit a decision worth recording.
- If you deviate from a spec, write the deviation + reason in the phase Log. Specs are the contract; this file is the state.
- Before implementing anything pi-related, re-read [02-pi-integration.md](02-pi-integration.md) and verify against the local pi docs it lists.

| Phase | Title | Status |
|---|---|---|
| P0 | Scaffold + RPC client + minimal streaming chat | ✅ |
| P1 | Full chat rendering | ⬜ |
| P2 | Workspaces, sessions, sidebar, resume, tree | ⬜ |
| P3 | Files pane, editor, diffs | ⬜ |
| P4 | Terminal | ⬜ |
| P5 | Artifacts | ⬜ |
| P6 | Settings, extension UI, theming, polish | ⬜ |
| P7 | Packaging, installer, CI | ⬜ |

---

## P0 — Scaffold + RPC client + minimal streaming chat  `✅`
Specs: [01-architecture.md](01-architecture.md) · [02-pi-integration.md](02-pi-integration.md)

- [x] Repo scaffold per §Repo layout: Electron main + preload + Vite/React/Tailwind renderer, TS strict, shared types package, lint/format, `npm run dev` with HMR
- [x] Zustand store skeletons (workspaces/sessions/chat/layout/settings)
- [x] `PiRpcClient` (main): spawn `pi --mode rpc` with cwd; strict LF JSONL framing (no readline); command/id correlation; typed event emitter; kill/cleanup; crash detection
- [x] Unit tests: framing (chunk splits mid-line, CRLF, U+2028 inside strings), correlation, subprocess lifecycle
- [x] pi health check on startup: PATH lookup + `--version` gate against MIN_PI_VERSION; "pi missing" setup screen
- [x] Typed IPC bridge (`pi:*`, `app:*`) with per-session event channels
- [x] Minimal chat: one hardcoded-workspace session, composer (Enter sends), streamed plain-text deltas render, Stop button (`abort`), errors surfaced

**Done when:** you can open the app in a folder, type a prompt, watch pi's answer stream in, and abort mid-stream. RPC client tests green.

**Log:**
- 2026-08-03 — P0 complete. Stack: Electron 43 + electron-vite 5 + Vite 7 + React 19 + Tailwind 4 + TS 6 (strict) + Vitest 4. MIN_PI_VERSION pinned to 0.78.0 (installed version verified). 17 unit tests green (JSONL framing incl. U+2028 mid-codepoint chunk splits; correlation incl. out-of-order responses; crash detection; clean dispose). Live probe against real `pi --mode rpc` verified: get_state/get_available_models handshake, streamed prompt, mid-stream abort (stopReason=aborted). Reference machine runs a custom local provider (`local-stark`), confirming no-Anthropic-assumptions. Deviations: workspace comes from a native folder picker instead of hardcoded (strictly better, feeds P2); preload emits CJS (`preload.cjs`) because sandboxed preloads require CommonJS.

---

## P1 — Full chat rendering  `⬜`
Specs: [04-chat.md](04-chat.md) · [02-pi-integration.md](02-pi-integration.md)

- [ ] Message view-model reducer for all events (agent/turn/message/tool/queue/compaction/retry) with incremental delta application
- [ ] Virtualized message list; autoscroll + jump-to-bottom pill
- [ ] Markdown pipeline (GFM, streaming-tolerant, fences render on close), Shiki/hljs code blocks with copy/language badge
- [ ] Thinking blocks (collapsed, `hideThinkingBlock` respected)
- [ ] Tool cards: read / bash (streaming output, exit badge) / edit (diff from `details.diff`/`patch`) / write / grep / find / ls
- [ ] Generic renderer for unknown/extension tools (pretty args, streaming output, error state)
- [ ] Mermaid, ```chart / ```vega-lite, ```html Code/Preview (sandboxed iframe), KaTeX, inline images with zoom
- [ ] Steering vs follow-up: Enter/Alt+Enter during streaming, queue chips from `queue_update`, Escape abort+restore
- [ ] `!` / `!!` bash commands; BashExecutionMessage rendering with context badge
- [ ] `/` command menu from `get_commands` + pidex commands; `@` file mention (basic index)
- [ ] Session header: model picker, thinking level, context meter + token/cost (`get_session_stats`), compact now, auto-compaction/retry toggles, steering/follow-up mode toggles, export HTML
- [ ] Compaction/branch-summary dividers; auto-retry strip with cancel; stopReason error/abort styling

**Done when:** a real coding session (multi-tool, diffs, mermaid, html preview, steering) reads beautifully end-to-end in light + dark.

**Log:**

---

## P2 — Workspaces, sessions, sidebar, resume, tree  `⬜`
Specs: [03-ui-shell.md](03-ui-shell.md) · [08-sessions.md](08-sessions.md)

- [ ] Workspace switcher + native folder picker + recents (app prefs)
- [ ] Session-dir scanner (JSONL header/name/first-message/mtime) + chokidar live updates + metadata cache
- [ ] Sidebar: session list w/ running indicators, pin, rename, delete(trash), export, fork, clone context menu
- [ ] Multiple concurrent live sessions; instant switching; background streaming with unread badges
- [ ] Resume: `--session <path>` + `get_messages` hydration
- [ ] Fork (from sidebar picker and from chat user-message), clone; handle `cancelled` responses
- [ ] Session tree view: parse tree, visualize branches/labels/leaf, jump/fork/label/preview actions, pan/zoom
- [ ] Crash banner + one-click resume; clean child shutdown on quit
- [ ] Onboarding: no-models state with "open terminal for `pi` login" hand-off (stub terminal OK until P4)

**Done when:** you can juggle two workspaces and 3+ concurrent sessions, resume yesterday's session, and fork from mid-conversation via the tree.

**Log:**

---

## P3 — Files pane, editor, diffs  `⬜`
Specs: [05-files-editor.md](05-files-editor.md) · [03-ui-shell.md](03-ui-shell.md)

- [ ] Resizable pane system (drag handles, persisted per-workspace layout, close/reopen, 60fps)
- [ ] File explorer: lazy tree, gitignore/hidden toggles, git status dots, chokidar refresh, context menu (reveal/copy/new/rename/trash)
- [ ] Fuzzy finder (Cmd/Ctrl+P) shared with `@` mentions
- [ ] Monaco editor: tabs, save, theme-matched, open-at-line links from chat
- [ ] External-change reload + dirty-conflict bar
- [ ] Files Changed panel: accumulate edit/write results, Monaco diff (patch chain and/or git session-baseline), summary counts, per-file revert (single confirm)
- [ ] Git chips: branch, ahead/behind, dirty count

**Done when:** agent edits land live in the tree/editor, every change is reviewable as a diff, and panes drag smoothly with persisted layout.

**Log:**

---

## P4 — Terminal  `⬜`
Specs: [06-terminal.md](06-terminal.md)

- [ ] node-pty service (per-OS shells) + xterm renderer, fit/links/search/clipboard addons
- [ ] Tabs, rename, close, scrollback setting, live theme/font switching
- [ ] "Run in terminal" from chat code blocks (paste, don't execute)
- [ ] Wire onboarding `pi` login hand-off to the real terminal

**Done when:** the terminal is a daily-drivable shell inside pidex on all three OSes.

**Log:**

---

## P5 — Artifacts  `⬜`
Specs: [07-artifacts.md](07-artifacts.md)

- [ ] `pi-ext/artifacts.ts`: `artifact_create` / `artifact_update` tools (payload in `details`), version counter, system-prompt note; loaded via `-e` for every session
- [ ] Artifacts pane: gallery, viewer (Code/Preview via chat renderers), auto-open on first artifact
- [ ] Version history + Monaco diff between versions
- [ ] Actions: copy, save to file, export PNG/SVG where applicable, open in Files pane
- [ ] Replay on resume from `get_messages`; verify persistence through session JSONL
- [ ] "Open as artifact" promotion from chat code blocks

**Done when:** "build me a dashboard mockup" yields a previewable, versioned artifact that survives app restart + session resume.

**Log:**

---

## P6 — Settings, extension UI, theming, polish  `⬜`
Specs: [09-settings.md](09-settings.md) · [02-pi-integration.md](02-pi-integration.md) §Extension-UI · [00-overview.md](00-overview.md)

- [ ] Extension-UI protocol complete: select/confirm/input/editor modal sheets (with cancel), notify toasts, setStatus strip, setWidget composer slots, setTitle, set_editor_text — tested against `examples/extensions/rpc-demo.ts` and the user-installed pi packages
- [ ] Settings window: Appearance / Agent (writes pi settings.json + project override) / Workspaces / Advanced (raw JSON editors, pi health) / Keybindings
- [ ] Theme system final pass: tokens across app/Monaco/xterm/Shiki/Mermaid, live switching, System mode
- [ ] Command palette (Cmd/Ctrl+K) for app actions
- [ ] Empty states, skeletons, error states everywhere; keyboard shortcut audit; a11y pass (focus rings, contrast, reduced motion)
- [ ] Performance audit: long-session virtualization, delta reduction, pane drag

**Done when:** an extension-heavy session (pi-web-access, pi-mcp-adapter) works flawlessly, and the app feels like the screenshots in both themes.

**Log:**

---

## P7 — Packaging, installer, CI  `⬜`
Specs: [10-packaging.md](10-packaging.md)

- [ ] electron-builder config for mac/linux/windows incl. node-pty rebuilds; icons/branding
- [ ] `scripts/install.sh` (OS/arch detect, checksum verify, install) + README one-liner
- [ ] GitHub Actions: PR checks (typecheck/lint/test/build) + tag-release matrix with artifacts, checksums, install.sh
- [ ] Playwright-Electron smoke e2e in CI (workspace → session → prompt → diff renders → artifact renders)
- [ ] About screen (app + pi versions); pi version-drift warning

**Done when:** a fresh machine can `curl … | sh`, launch pidex, and run a session — with CI producing the artifacts on tag.

**Log:**
