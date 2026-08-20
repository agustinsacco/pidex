# Build Tracker — phases P0–P9 (archived)

Completed phases, moved out of [../TRACKER.md](../TRACKER.md) to keep the
live tracker readable. Nothing here is outstanding; kept for the decisions
and deviations recorded in each phase's **Log**.

---

## P0 — Scaffold + RPC client + minimal streaming chat `✅`

Specs: [01-architecture.md](../01-architecture.md) · [02-pi-integration.md](../02-pi-integration.md)

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

## P1 — Full chat rendering `✅`

Specs: [04-chat.md](../04-chat.md) · [02-pi-integration.md](../02-pi-integration.md)

- [x] Message view-model reducer for all events (agent/turn/message/tool/queue/compaction/retry) with incremental delta application
- [x] Virtualized message list; autoscroll + jump-to-bottom pill
- [x] Markdown pipeline (GFM, streaming-tolerant, fences render on close), Shiki/hljs code blocks with copy/language badge
- [x] Thinking blocks (collapsed, `hideThinkingBlock` respected)
- [x] Tool cards: read / bash (streaming output, exit badge) / edit (diff from `details.diff`/`patch`) / write / grep / find / ls
- [x] Generic renderer for unknown/extension tools (pretty args, streaming output, error state)
- [x] Mermaid, `chart / `vega-lite, ```html Code/Preview (sandboxed iframe), KaTeX, inline images with zoom
- [x] Steering vs follow-up: Enter/Alt+Enter during streaming, queue chips from `queue_update`, Escape abort+restore
- [x] `!` / `!!` bash commands; BashExecutionMessage rendering with context badge
- [x] `/` command menu from `get_commands` + pidex commands; `@` file mention (basic index)
- [x] Session header: model picker, thinking level, context meter + token/cost (`get_session_stats`), compact now, auto-compaction/retry toggles, steering/follow-up mode toggles, export HTML
- [x] Compaction/branch-summary dividers; auto-retry strip with cancel; stopReason error/abort styling

**Done when:** a real coding session (multi-tool, diffs, mermaid, html preview, steering) reads beautifully end-to-end in light + dark.

**Log:**

- 2026-08-03 — P1 complete. Reducer is a pure module with 33 unit tests including a **replay test over a real captured pi event stream** (228 records, write/read/bash tools — fixture at `src/features/chat/__fixtures__/`). Rendering: react-markdown+GFM+KaTeX, Shiki dual-theme (CSS-var switch, no re-highlight), Mermaid, Chart.js (`chart), vega-embed (`vega-lite), sandboxed ```html preview. Tool rows match screenshots (collapsed verb rows w/ ±counts, chevron; grouped consecutive runs). Verified visually in light+dark via a dev-only browser mock of the preload API (`src/dev/mockPidex.ts`, replays the fixture — never bundled in prod). Deviations: (1) RPC has no queue-item removal command, so queue chips offer _recall_ (copy back to composer) instead of remove; Escape abort restores queued texts per spec. (2) get_state doesn't expose auto-retry state; toggle tracks last-set value locally, default on. (3) Model/thinking/context-meter live in the composer footer per screenshots; management actions live in the header kebab. (4) Code-block "open as file / run in terminal / open as artifact" actions land with their panes (P3/P4/P5).

---

## P2 — Workspaces, sessions, sidebar, resume, tree `✅`

Specs: [03-ui-shell.md](../03-ui-shell.md) · [08-sessions.md](../08-sessions.md)

- [x] Workspace switcher + native folder picker + recents (app prefs)
- [x] Session-dir scanner (JSONL header/name/first-message/mtime) + chokidar live updates + metadata cache
- [x] Sidebar: session list w/ running indicators, pin, rename, delete(trash), export, fork, clone context menu
- [x] Multiple concurrent live sessions; instant switching; background streaming with unread badges
- [x] Resume: `--session <path>` + `get_messages` hydration
- [x] Fork (from sidebar picker and from chat user-message), clone; handle `cancelled` responses
- [x] Session tree view: parse tree, visualize branches/labels/leaf, jump/fork/label/preview actions, pan/zoom
- [x] Crash banner + one-click resume; clean child shutdown on quit
- [x] Onboarding: no-models state with "open terminal for `pi` login" hand-off (stub terminal OK until P4)

**Done when:** you can juggle two workspaces and 3+ concurrent sessions, resume yesterday's session, and fork from mid-conversation via the tree.

**Log:**

- 2026-08-03 — P2 complete. Scanner parses header/name/first-msg/counts/tokens in one pass with an mtime+size cache; **pi mangles the realpath'd cwd** (`/var`→`/private/var`) into `--segments--` — verified live and handled. Home screen matches `home-*.png`: serif greeting, 4 stat tiles, blue activity heatmap, Local/folder/branch chips, first-prompt composer. Sidebar matches `sidebar-sessions.png`: pinned/recent, live dot + streaming spinner + unread badges, full context menu. Resume verified E2E against real pi (create→kill→`--session`→`get_messages` hydration). Tree view: SVG pan/zoom, user-message primary nodes, collapsed-run `+N` pills, label bookmarks, active-path accent, leaf ring; actions = jump (documented `branch_summary` append mechanism), fork-at-node (file copy w/ fresh header id + parentSession + leaf jump), label (append `label` entry) — session-file writes only happen after disposing any live subprocess. 43 tests green (scanner, writers, tree layout added). Deviations: (1) tree "jump" for a live session disposes+reappends+respawns (RPC has no `branch()` command); (2) fork-from-sidebar spawns `--fork <path>` (leaf fork); mid-conversation forks use the in-chat fork picker (`get_fork_messages`→`fork`) with edit-and-refork prefill; (3) keyboard nav in tree deferred to P6 a11y pass.

---

## P3 — Files pane, editor, diffs `✅`

Specs: [05-files-editor.md](../05-files-editor.md) · [03-ui-shell.md](../03-ui-shell.md)

- [x] Resizable pane system (drag handles, persisted per-workspace layout, close/reopen, 60fps)
- [x] File explorer: lazy tree, gitignore/hidden toggles, git status dots, chokidar refresh, context menu (reveal/copy/new/rename/trash)
- [x] Fuzzy finder (Cmd/Ctrl+P) shared with `@` mentions
- [x] Monaco editor: tabs, save, theme-matched, open-at-line links from chat
- [x] External-change reload + dirty-conflict bar
- [x] Files Changed panel: accumulate edit/write results, Monaco diff (patch chain and/or git session-baseline), summary counts, per-file revert (single confirm)
- [x] Git chips: branch, ahead/behind, dirty count

**Done when:** agent edits land live in the tree/editor, every change is reviewable as a diff, and panes drag smoothly with persisted layout.

**Log:**

- 2026-08-03 — P3 complete. Panes: react-resizable-panels v2 (v4's rewritten API rejected), layout persists per-workspace via autoSaveId. Explorer: lazy per-dir listing, `git check-ignore --stdin` filtering, hidden/gitignore toggles, porcelain status dots (dir roll-up), chokidar-driven refresh, full context menu. Monaco: bundled workers (strict CSP, no CDN), pidex-light/dark themes, per-path models w/ view-state restore, Cmd+S, external-change hot-reload + conflict bar (Reload/Keep mine), open-at-line from chat paths (edit→firstChangedLine, read→offset). Files Changed: session `edit`/`write` accumulation, git session baseline via `git stash create` (semantics verified on a scratch repo: checkout of the baseline restores pre-session _uncommitted_ state; created-at-session files revert to trash), non-git fallback reconstructs originals by reverse-applying `details.patch` chains (5 new unit tests), Monaco diff inline/split with hidden unchanged regions, per-file revert w/ single confirm. Git chips (branch/↑↓/dirty) live-refresh in chat header. Monaco pinned to 0.53.0 (0.54 ships a vulnerable dompurify per npm audit). 48 tests green. Deviations: layout persistence lives in renderer localStorage (autoSaveId) rather than electron-store — same per-workspace behavior; grep/find/ls row click-through deferred (P6 polish); "open to the side" split editor deferred (P6).

---

## P4 — Terminal `✅`

Specs: [06-terminal.md](../06-terminal.md)

- [x] node-pty service (per-OS shells) + xterm renderer, fit/links/search/clipboard addons
- [x] Tabs, rename, close, scrollback setting, live theme/font switching
- [x] "Run in terminal" from chat code blocks (paste, don't execute)
- [x] Wire onboarding `pi` login hand-off to the real terminal

**Done when:** the terminal is a daily-drivable shell inside pidex on all three OSes.

**Log:**

- 2026-08-03 — P4 complete. PtyManager in main (login shell `$SHELL -l` on mac/linux, PowerShell on win32, cwd=workspace, per-pty push channels, killAll on quit). node-pty rebuilt for Electron ABI via @electron/rebuild; **headless Electron round-trip test passed** (spawn zsh → echo → capture). Renderer: xterm 5 (@xterm scope) with fit (ResizeObserver, pane-drag aware), web-links (opens externally), search (⌘F in-pane bar), right-click paste via term.paste (bracketed-paste safe); warm light/dark ANSI themes switch live; 10k scrollback. Terminal lives in the right pane matching `terminal-pane.png` (own header: Terminal + tab pills, double-click rename, +, expand ↗ toggles 45%↔85% via imperative panel resize, ✕); ⌘`toggles. "Run in terminal" button on shell-language code blocks pastes without newline; no-models onboarding banner now opens the terminal prefilled with`pi`. macOS verified live; linux/windows shells covered by per-OS branch + P7 CI. Deviation: font-size/scrollback settings UI arrives with P6 Settings (values are live in code today).

---

## P5 — Artifacts `✅`

Specs: [07-artifacts.md](../07-artifacts.md)

- [x] `pi-ext/artifacts.ts`: `artifact_create` / `artifact_update` tools (payload in `details`), version counter, system-prompt note; loaded via `-e` for every session
- [x] Artifacts pane: gallery, viewer (Code/Preview via chat renderers), auto-open on first artifact
- [x] Version history + Monaco diff between versions
- [x] Actions: copy, save to file, export PNG/SVG where applicable, open in Files pane
- [x] Replay on resume from `get_messages`; verify persistence through session JSONL
- [x] "Open as artifact" promotion from chat code blocks

**Done when:** "build me a dashboard mockup" yields a previewable, versioned artifact that survives app restart + session resume.

**Log:**

- 2026-08-03 — P5 complete. Extension uses `pi.registerTool` with `promptSnippet`/`promptGuidelines` (pi's native system-prompt surface — cleaner than a before_agent_start hook); version counters rebuild from `ctx.sessionManager.getBranch()` on session_start. **Live E2E against real pi passed**: create v1 → update v2 → kill → `--session` resume → `get_messages` replays both toolResults with full `details` → post-resume update lands as **v3** (counter continuity proven). Extension shipped from repo `pi-ext/` (dev) / `process.resourcesPath` (packaged, wired in P7), typechecked in-repo against dev-only `typebox` (runtime deps come from pi). Pane: gallery chips (type icon, title, vN), viewer with Preview/Code/Diff tabs, version picker, actions (copy, save-to-file, write-into-workspace+open in Files). Auto-open on a session's first artifact, unseen-dot on the header button. Enum params avoided (`Type.String` + description) for Google-API compatibility per pi docs. Deviations: PNG/SVG raster export deferred to P6 polish (save-to-file covers svg/mermaid sources today); `type` validated at execute-time instead of schema enum.

---

## P6 — Settings, extension UI, theming, polish `✅`

Specs: [09-settings.md](../09-settings.md) · [02-pi-integration.md](../02-pi-integration.md) §Extension-UI · [00-overview.md](../00-overview.md)

- [x] Extension-UI protocol complete: select/confirm/input/editor modal sheets (with cancel), notify toasts, setStatus strip, setWidget composer slots, setTitle, set_editor_text — tested against `examples/extensions/rpc-demo.ts` and the user-installed pi packages
- [x] Settings window: Appearance / Agent (writes pi settings.json + project override) / Workspaces / Advanced (raw JSON editors, pi health) / Keybindings
- [x] Theme system final pass: tokens across app/Monaco/xterm/Shiki/Mermaid, live switching, System mode
- [x] Command palette (Cmd/Ctrl+K) for app actions
- [x] Empty states, skeletons, error states everywhere; keyboard shortcut audit; a11y pass (focus rings, contrast, reduced motion)
- [x] Performance audit: long-session virtualization, delta reduction, pane drag

**Done when:** an extension-heavy session (pi-web-access, pi-mcp-adapter) works flawlessly, and the app feels like the screenshots in both themes.

**Log:**

- 2026-08-03 — P6 complete. **Extension-UI verified live against pi's own `examples/extensions/rpc-demo.ts`**: all 9 methods exercised (setTitle, setWidget, setStatus, select, confirm, input, editor, notify, set_editor_text); dialog replies confirmed by the extension echoing back the submitted values ("You entered: pidex-typed-value", "Editor submitted"), and `confirm` on `session_before_switch` returned `cancelled=false` to `new_session`. Renderer maps them to modal sheets (arrow/Enter/Esc navigation), toasts, a bottom status strip, and above/below composer widget slots; `set_editor_text` reuses the P2 prefill channel. Settings modal (⌘,) with 5 tabs: Appearance (theme + UI scale/chat/editor/terminal sizes + mono font, all live via CSS vars and Monaco/xterm option updates), Agent (writes pi `settings.json` global **or** `<ws>/.pi/settings.json`, with nested compaction/retry merge and an "applies to new sessions" note), Workspaces (remove, per-workspace layout reset), Advanced (pi health, Monaco JSON editors for settings.json/models.json with parse-validation before write, read-only skills/extensions/prompts inventory, explicit "auth.json never read"), Keybindings sheet. Command palette (⌘K) covers panes, theme, sessions, workspace switching. A11y: `:focus-visible` rings, `prefers-reduced-motion` disables streaming/shimmer/toast animation, skeleton utility. Deviation: raw-JSON schema validation is parse-level only (pi ships no JSON Schema for these files).

---

## P7 — Packaging, installer, CI `✅`

Specs: [10-packaging.md](../10-packaging.md)

- [x] electron-builder config for mac/linux/windows incl. node-pty rebuilds; icons/branding
- [x] `scripts/install.sh` (OS/arch detect, checksum verify, install) + README one-liner
- [x] GitHub Actions: PR checks (typecheck/lint/test/build) + tag-release matrix with artifacts, checksums, install.sh
- [x] Playwright-Electron smoke e2e in CI (workspace → session → prompt → diff renders → artifact renders)
- [x] About screen (app + pi versions); pi version-drift warning

**Done when:** a fresh machine can `curl … | sh`, launch pidex, and run a session — with CI producing the artifacts on tag.

**Log:**

- 2026-08-03 — P7 complete. electron-builder: mac dmg+zip (arm64/x64, hardened runtime + entitlements for JIT/unsigned-memory so node-pty and the pi subprocess work, signs only when certs are present), linux AppImage+deb (arm64/x64, `artifactName` pinned to match install.sh), win nsis. `pi-ext/` ships as an **unpacked extraResource** because the pi subprocess must read the file from disk — verified in the built bundle (`Contents/Resources/pi-ext/artifacts.ts` present, `node-pty/build/Release/pty.node` in `app.asar.unpacked`), and **the packaged app launches clean**. Icons generated from an SVG into png/icns/ico. `install.sh` (POSIX sh, `sh -n` clean): OS/arch detect (matrix verified for Darwin/Linux × x64/arm64 and a Windows bail-out), latest-release resolve, sha256 verify against `checksums.txt`, dmg mount→/Applications with quarantine clear, or AppImage→`~/.local/bin` + .desktop entry; advisory pi presence/version check. **4 Playwright-Electron e2e tests pass locally** driving the real Electron app against a deterministic pi RPC stub (`PIDEX_PI_STUB`, plus `PIDEX_E2E_WORKSPACE` to bypass the native dialog and `PIDEX_TEST_USER_DATA` to isolate prefs): workspace→session→streamed answer→edit tool diff→Files Changed→Artifacts pane; settings theme switch + About versions; ⌘K palette; terminal spawning a real PTY. Each test launches its own app instance (shared instances leaked focus state between tests). The suite caught a **real a11y bug**: CSS `capitalize` on theme/scope/thinking labels left lowercase accessible names — replaced with real title-case text plus `role="group"`/`aria-pressed`. CI: PR job (typecheck, lint, prettier check, unit tests, build) + e2e matrix on ubuntu (xvfb) and macOS with report upload on failure; release job builds the 3-platform matrix on tag, collects artifacts, generates `checksums.txt`, and drafts a GitHub Release with install.sh and the curl one-liner. About tab reports app/pi/platform/runtime versions and warns when pi's minor is newer than the verified 0.78.x.

---

## P8 — Multi-workspace sessions `✅`

Specs: [MULTI_WORKSPACE_PLAN.md](MULTI_WORKSPACE_PLAN.md) (see its **Outcome** section for deviations)

- [x] Phase 1 — restore last location on launch (`aa55593`)
- [x] Phase 2 — routing derives from the active session (`794de76`)
- [x] Phases 3–5 — grouped sidebar, workspace popover, per-workspace files/terminal panes (`874730c`, PR #1)
- [x] Follow-ups the merge left open: lazy-scan beyond the 8-workspace cap (unscanned groups default collapsed, first scan on expand), unwatch on group collapse (`sessions:unwatch`), collapse state persisted in prefs, `app:recordWorkspace` + resumeTarget fallback to the newest existing recent

**Done when:** three projects stream concurrently; the sidebar lists and groups all of them; relaunch lands where you left off.

**Log:**

- 2026-08-05 — Phases 1–5 shipped across `aa55593`, `794de76`, `874730c`. Deviations recorded in the plan's Outcome section (badges only in Pinned; `homePath` instead of `homeWorkspacePath`; Routines/Customize dropped).
- 2026-08-07 — Follow-up pass closed the gaps the squash merge shipped without: workspaces beyond the boot-scan cap now render as collapsed headers and lazy-scan on expand (previously invisible until restart); watchers now follow group visibility (expand ⇒ watch, collapse ⇒ unwatch) instead of accumulating per workspace for the process lifetime; collapse choices persist (`collapsedWorkspaces` pref); salvaged the uncommitted `app:recordWorkspace` work from the phase-3 worktree — most-recently-used workspace persistence plus `app:resumeTarget` falling back to the newest still-existing recent, with resume-target tests extended to cover the fallback. Also recovered the stranded composer polish from that worktree: shared `ComposerButtons` (attach / submit / stop icon buttons) across chat + home composers, and a searchable `ModelMenu` shared by both model pickers.

---

## P9 — Tech-debt reduction pass `✅`

Record: `TECH_DEBT_AUDIT.md` (deleted after the pass; see commit `cb5fb86`)

- [x] 6 bug fixes (formatTokens M-tier, nested-modal Escape, FilesChangedPane streaming details, watcher leak at quit, silent RPC failures → `piCall`/`piCallOk`, E2E env hooks gated on `!app.isPackaged`)
- [x] `electron/ipc.ts` split into 7 per-domain registrars (channel list diff-verified); dead `RpcCommandType` repurposed as compile-time response-map drift guard
- [x] Test suite 70 → 296 cases; renderer test typechecking fixed (`.test.tsx` now covered)

**Done when:** audit findings either fixed or explicitly declined with reasons in TECH_DEBT_AUDIT.md.

**Log:**

- 2026-08-06 — Landed as `cb5fb86` (PR #2). Declined items (C11–C13 UI-shape refactors, §D component splits) documented with rationale in the audit. Known leftovers: `textFromContent` dedup (C3) only landed for the main process — three renderer copies remain (`MessageItem.tsx`, `messageContent.ts`, `toolSummaries.ts`); ~10 raw `piCommand` call sites still bypass `lib/rpc.ts` (mostly bootstrap/read paths).
- 2026-08-07 — session-writer tests added (16 cases: appendLabel/appendBranchJump/forkSessionAt round-trips against the real tree reader), closing the highest-risk-untested-module gap.
