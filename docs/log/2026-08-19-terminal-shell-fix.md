# 2026-08-19 — Terminal: the shell that never started, and panes that followed you

Three defects behind one report ("open the terminal and it's stuck").

**1. No shell would ever spawn (root cause).** node-pty execs a small
`spawn-helper` binary that it looks for next to whichever `pty.node` actually
loaded — `build/Release` first, then the shipped
`prebuilds/<platform>-<arch>`. On an Apple Silicon dev machine the locally
compiled `build/Release/pty.node` was x86_64, so it failed `dlopen` under an
arm64 Electron and the loader silently fell through to the arm64 prebuild —
whose `spawn-helper` npm unpacks as `0644`. Missing the exec bit, every
`pty.spawn()` threw `posix_spawnp failed.`

Evidence (probes under the app's own Electron binary): `build/Release` →
`incompatible architecture (have 'x86_64', need 'arm64')`; prebuild loads;
helper is `-rw-r--r--`; spawn fails; after `chmod +x`, spawn returns a live
pid and real zsh prompt bytes.

Fixed at both ends: `scripts/fix-node-pty.mjs` (wired into `postinstall`)
repairs it at install time, and `electron/pty/spawn-helper.ts`
(`ensureSpawnHelperExecutable`, called once before the first spawn) repairs
installs that predate the script and packaged builds. It chmods _every_
candidate directory, not just the one that loaded, so a later correct rebuild
that flips the loader back to `build/Release` stays fixed.

**2. The failure was invisible.** `TerminalPane`'s first-open effect latched
`spawnRequested` _before_ awaiting, and called `createTab` as
`void createTab(...)`. A rejected `pty:create` therefore produced an unhandled
rejection, no tab, no error, and no retry path — the pane sat on
"Starting shell…" forever. Now: `PtyManager.create` rethrows with the likely
cause attached, `createTab` resolves `null` and records `error` on the
session's slice, the pane renders that message with a "Try again" button, and
the latch is released on failure.

**3. The right pane was global, so it followed you between sessions.**
`useLayoutStore.rightPane` was a single value. Opening a terminal in one
session showed the pane in every session you switched to, and since first open
auto-spawns, merely _visiting_ another session forked a login shell there.
`bySession` now keys `{ pane, expanded }` per session (the `sessionTerminals`
idiom); actions take an optional `sessionId` and default to the active session
so call sites stay one-liners; `useRightPane()` / `useRightExpanded()` combine
both stores because the answer also changes when the active session changes.
Disposing a session drops its slice. `receiveArtifact`'s "is the pane open?"
check is now scoped to the artifact's own session rather than reading the
foreground session's state.

**Also:** closing the pane disposes each xterm but keeps the PTY, so
reopening showed a blank rectangle in front of a live shell. `PtyManager` now
keeps a 256 KB tail per PTY and `pty:attach` replays it. No de-duplication is
needed: `onData` appends before broadcasting, so the snapshot is a superset of
anything the reattaching view buffered during the round trip, and that view
discards its buffer rather than guessing.

**Test-integrity fix found along the way.** `main.ts` decides dev-vs-built
purely from `ELECTRON_RENDERER_URL`, which `npm run dev` exports to every
child process. Running the e2e suite from a shell descended from a dev server
launched the _built_ main against the _dev server's_ renderer — the suite was
testing code that had never been built, passing for the wrong reasons and
failing on changes it had never loaded (this masked the reattach work for
several runs). `launch()` now strips electron-vite's dev markers.

Coverage: 4 unit tests for `ensureSpawnHelperExecutable` (verified failing
when the chmod is removed), 8 for `PtyManager` spawn-failure messages and
scrollback bounds/superset/eviction, 4 for the terminal store's error path, 9
for the per-session layout store, plus two e2e tests — the terminal test now
asserts it gets _past_ "Starting shell…", round-trips a real `echo` marker,
and still sees the marker after close/reopen; a new test asserts a terminal
opened in one session is absent in another and returns on switching back
(verified failing against emulated global-pane behavior).

**Flaky assertion fixed (macOS CI).** `a long tool run collapses to one dense
group` sampled the activity group's height **once**, immediately after
`aria-expanded` flipped to `"false"` — but that instant is when the 220ms
`grid-template-rows: 1fr → 0fr` collapse _starts_. macOS CI measured 61px of a
group that settles at ~33px. It now polls until settled (a group that genuinely
stays tall still fails on timeout; verified by forcing the track to `1fr`, which
reports 1230px and fails). The post-click measurement got the same treatment,
where the race could only have produced false _passes_.

**Styling:** removed `border-b` from the `PaneShell` header (Files, Changes,
Terminal, Artifacts). The pane is already a bordered rounded card, so the rule
under the title drew a second horizontal line a few pixels inside the first.
