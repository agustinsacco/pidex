# Multi-workspace sessions — implementation plan

> **Status: shipped.** Phases 1–2 landed as `aa55593` / `794de76`; phases
> 3–5 landed squashed as `874730c` (PR #1). Deviations and follow-ups are
> recorded in the **Outcome** section at the bottom — read that before
> treating any phase text as current.

Today pidex is a **single-workspace app**: you pick one folder, and every
session, the sidebar, the file tree and the git chips are scoped to it.
Working on three projects means closing one and opening another.

The target is Claude Code's model: **the workspace is a property of the
session, not of the app.** The sidebar lists sessions across every
workspace, "New session" chooses its folder, and three projects can stream
concurrently.

---

## The good news: the backend is already there

This is a renderer-layer change. The main process never assumed one
workspace:

- `SessionRegistry.create(workspacePath, …)` spawns **one pi subprocess per
  session** with that folder as `cwd` — three sessions in three folders
  already works today (`electron/pi/session-registry.ts`).
- `LiveSession` carries its own `workspacePath`.
- Every fs / git / session-scan IPC handler already **takes
  `workspacePath` as an argument** rather than reading global state.
- `useSessionsStore.disk` is already keyed `workspacePath → SessionMeta[]`,
  and `live[pidexId]` already stores each session's own `workspacePath`.

Nothing in `electron/` needs to change for the core feature.

## The actual constraint

One line: `useWorkspacesStore.currentPath: string | null`.

Everything funnels through it:

| Consumer                   | Today                                              |
| -------------------------- | -------------------------------------------------- |
| `App.tsx:28`               | gates the whole app — no path ⇒ `WorkspacePicker`  |
| `App.tsx:72,75`            | passes one path into `Sidebar` and `MainWithPanes` |
| `Sidebar.tsx:17`           | lists only `disk[thatOnePath]`                     |
| `ToolCard.tsx:21`          | resolves file-open paths against it                |
| `SettingsModal.tsx:222`    | project-scope settings target                      |
| `useGlobalShortcuts.ts:64` | gates ⌘P                                           |

So the sidebar can't show another project's sessions, and creating a
session in a different folder means switching the entire app.

---

## Target model

```
AppState
├── workspaces: WorkspaceInfo[]        // known folders (already persisted)
├── sessions (live + on-disk)          // each owns its workspacePath
└── activeSessionId                    // THE routing primitive
```

`activeSession.workspacePath` replaces `currentPath` as the answer to
"which folder am I in?". There is no app-level current workspace — only a
current _session_, which knows its folder.

---

## Phase 1 — Restore last location on launch (**small, ship first**)

`lastWorkspacePath` is already written by `recordWorkspace()` and **never
read on boot** (`grep` confirms: written in `store.ts:58`, read nowhere).
Today every launch lands on the picker even after months of use.

- persist `lastActiveSessionPath` alongside it
- on boot: if that session file still exists → resume it directly;
  else if `lastWorkspacePath` exists → land on its home screen;
  else → the picker
- guard: if the folder was deleted or moved, fall through to the picker
  with a toast rather than erroring

Files: `electron/store.ts`, `shared/models.ts`, `src/app/App.tsx`,
`src/stores/sessions.ts`.

## Phase 2 — Decouple routing from a single workspace

Replace `currentPath` with derived state:

```ts
// workspaces store keeps the *list* and recents; it stops owning "current"
const activeWorkspace = useSessionsStore((s) =>
  s.activeSessionId ? s.live[s.activeSessionId]?.workspacePath : s.homeWorkspacePath,
)
```

- add `homeWorkspacePath` — the folder the **home screen** is composing
  against when no session is active (this is what the workspace switcher
  changes)
- `App.tsx` routes on `activeSessionId ?? homeWorkspacePath ?? picker`
- `ToolCard`, `SettingsModal`, shortcuts read the derived value

Deliberate: keep `WorkspacePicker` only as the true-empty state (no
workspaces known at all).

Files: `src/stores/workspaces.ts`, `src/stores/sessions.ts`,
`src/app/App.tsx`, `ToolCard.tsx`, `SettingsModal.tsx`,
`useGlobalShortcuts.ts`.

## Phase 3 — Sidebar: grouped sessions with workspace badges

The headline change. Two distinct requirements from the reference:

**(a) Group sessions by workspace.** Group headers are plain grey labels
(the reference's `Pinned` / `Tool Agent` / `Ungrouped` treatment), with
their sessions indented beneath:

```
Pinned
  ⑂ Migrate Knowledge Tools Fully AR      pidex
  ⑂ Global Chat Routine Overhaul          augment-services
pidex
  ● Refactor auth module                  (live)
    Why is the vite build slow?
augment-services
  ● Fix carrier selection
```

**(b) Every session row carries a small workspace badge.** Even inside a
group, each row shows which project it belongs to — so a glance at the
list answers "which app is this thread for?" without reading headers.
Reference styling: small, low-contrast, right-aligned in the row.

Note these are complementary, not redundant: **Pinned** (and any future
cross-cutting group) mixes workspaces, so the badge is the only signal
there. Rows in a workspace group can dim/omit the badge to avoid noise —
decide during implementation by eye.

- scan **all known workspaces** on mount, not just one — `sessions:list`
  already takes a path, so this is N calls in parallel
- watch each known workspace (`sessions:watch` per path); the existing
  `fs:changed` push already carries `workspacePath` for routing
- group headers collapse/expand, persisted in prefs
- a workspace with a **live session** sorts first
- badge text = folder basename; full path in `title`

Cost note: N workspaces × a session-dir scan on boot. The scanner already
has an mtime+size cache, so warm boots are cheap; cap the initial scan at
the ~8 most recent workspaces and lazy-scan the rest on expand.

Files: `src/features/sessions/Sidebar.tsx` (substantial),
`src/stores/sessions.ts` (multi-workspace refresh + watch).

## Phase 4 — "New" button and the workspace popover

Two corrections to the earlier draft, both from the reference:

**(a) The New button is a flat nav row, not a bordered button.** It sits
at the top of the sidebar as the first of `New · Artifacts · Routines ·
Customize` — icon + label, no border, no shadow, hover `bg-bg-secondary`,
with the whole group visually distinct from the session list below. This
supersedes the current bordered "New session" button and is the same work
as **A3** in the UX plan; do them together.

Clicking **New** does _not_ open a folder menu. It routes to the home
screen (clears `activeSessionId`) — matching the reference, where New
lands you on the greeting screen ready to compose.

**(b) The workspace picker is a popover on the composer's folder chip.**
The chip row under the home composer already renders `Local · <folder> ·
<branch>` (`WorkspaceHome.tsx:74-77`). Clicking the **folder chip** opens
a popover anchored there:

```
Recent
  pidex            ✓        ← current, checked
  augment-dbt
  augment-services
  augment-local
  brigades
  vedy
  ────────────
  Open folder…
```

Selecting a folder re-points the home screen at it; the composer, git
chip and stats all follow. "Open folder…" runs the native picker and
**adds** a workspace rather than replacing the current one. The chosen
path flows into `createSession(path, …)`, which already accepts any path.

This is strictly better than a menu on New: the folder is visible at the
moment you compose, next to the branch you're on, rather than a decision
made one screen earlier.

Files: `src/features/sessions/Sidebar.tsx` (nav rows),
`src/features/home/WorkspaceHome.tsx` (chip popover),
`src/stores/workspaces.ts` (`homeWorkspacePath` setter, add-not-replace).

## Phase 5 — Per-workspace panes

The right-hand panes are global today and would show the wrong project's
files after switching sessions:

- `useFilesStore` — `entries`, `expanded`, `gitStatus`, `openFiles` are
  globally keyed → re-key by `workspacePath`
- `useTerminalStore.tabs` — a terminal's cwd is its workspace → key tabs by
  workspace so switching sessions swaps terminal sets (do **not** kill
  PTYs; they keep running)
- artifacts are already per-session ✓
- `FilesChangedPane` already takes `workspacePath` ✓

This is the subtlest phase: a stale open editor from another project is
worse than no editor.

Files: `src/stores/files.ts`, `src/stores/terminal.ts`,
`src/features/files/*`.

---

## Risks

1. **Session-switch flicker.** Switching between workspaces re-scans the
   tree and git status. Mitigate by keying caches per workspace (phase 5)
   so a revisit is instant.
2. **Watcher fan-out.** One chokidar watcher per workspace, plus the
   session dirs. Cap eagerly-watched workspaces; unwatch on group collapse.
3. **Boot cost.** Phase 3's N-workspace scan is the main new cost on
   startup — parallelise, cap, and lazy-load.
4. **`recordWorkspace` semantics.** It currently sets `lastWorkspacePath`
   on every session create; with multiple workspaces that should track
   _most recently used_, not _only_.

## Order

| Phase                         | Value              | Risk    |
| ----------------------------- | ------------------ | ------- |
| 1 · restore last location     | high / immediate   | trivial |
| 2 · decouple routing          | enables the rest   | low     |
| 3 · sidebar all workspaces    | **the feature**    | medium  |
| 4 · new-session folder picker | completes the loop | low     |
| 5 · per-workspace panes       | correctness        | medium  |

Phases 1–2 are safely shippable on their own. Phase 3 is where it starts
to feel like Claude Code.

## e2e

- launch with a persisted last session → lands there, not the picker
- two workspaces, one session each → both listed, both groups visible,
  **and each row shows its workspace badge**
- clicking the composer's folder chip opens the popover; picking another
  workspace re-points the home screen (folder chip + git chip + stats)
- "Open folder…" adds a workspace without dropping the previous one
- start a session in workspace B while A is streaming → A keeps streaming
  (assert its dot stays live), B renders its own tree and git chips
- switch back to A → A's open editors and terminal tabs return, not B's

The badge assertion is the cheap regression guard for the whole feature:
if a row's badge is wrong, session→workspace association has broken.

---

## Outcome (2026-08-07)

All five phases shipped. Deviations from the text above, and where the plan's
requirements landed late:

- **Phase 2:** `homeWorkspacePath` shipped as `homePath` on
  `useWorkspacesStore`; the derived answer is `useActiveWorkspace()` /
  `getActiveWorkspace()` in `src/stores/workspaces.ts`.
- **Phase 3 badges:** rows inside a workspace group omit the badge entirely
  (the "dim or omit — decide by eye" call); only the cross-workspace
  **Pinned** group renders badges (`showWorkspace` on `SessionRow`).
- **Phase 3 collapse/lazy-scan/unwatch — landed late (2026-08-07), not in
  `874730c`:** the original merge shipped the 8-workspace scan cap without
  the lazy-load path (groups beyond the cap were invisible), never unwatched
  on collapse (risk #2's mitigation), and kept collapse state in component
  state only. Now: unscanned groups render collapsed by default and their
  first scan runs on expand; expanded ⇔ watched, collapsed ⇒ unwatched
  (`sessions:unwatch`, plus `unwatchAll` at quit); explicit collapse choices
  persist in prefs (`collapsedWorkspaces`, `app:setCollapsedWorkspaces`).
- **Phase 4:** New/Artifacts shipped as flat nav rows; the UX plan's
  Routines · Customize rows and Home/Code toggle did **not** ship (see
  `UX_REFACTOR_PLAN.md` A3).
- **Risk #4 (`recordWorkspace` semantics) — landed late (2026-08-07):**
  `app:recordWorkspace` now persists most-recently-used on workspace open and
  session activation, and `app:resumeTarget` falls back to the newest
  still-existing recent before showing the picker.
- **e2e:** the two-workspaces + badge + relaunch-restore scenarios are in
  `e2e/smoke.spec.ts`; the concurrent-streaming and pane-swap scenarios from
  the list above are still untested.
