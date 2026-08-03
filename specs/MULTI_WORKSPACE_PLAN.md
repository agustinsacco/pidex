# Multi-workspace sessions — implementation plan

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

## Phase 3 — Sidebar lists every workspace

The headline change. Sidebar shows sessions **grouped by workspace**:

```
▾ pidex                         ← workspace group header
    ● Refactor auth module          (live, streaming)
      Why is the vite build slow?
▾ augment-services
    ● Fix carrier selection
  augment-web                   ← collapsed, no live sessions
```

- scan **all known workspaces** on mount, not just one — `sessions:list`
  already takes a path, so this is N calls in parallel
- watch each known workspace (`sessions:watch` per path); the existing
  `fs:changed` push already carries `workspacePath` for routing
- group headers collapse/expand, persisted in prefs
- a workspace with a **live session** sorts first and shows a running dot
- badge each group with its live-session count

Cost note: N workspaces × a session-dir scan on boot. The scanner already
has an mtime+size cache, so warm boots are cheap; cap the initial scan at
the ~8 most recent workspaces and lazy-scan the rest on expand.

Files: `src/features/sessions/Sidebar.tsx` (substantial),
`src/stores/sessions.ts` (multi-workspace refresh + watch).

## Phase 4 — "New session" picks its workspace

Today the button just clears `activeSessionId` and lands on the home
screen for the one workspace.

Target: a small menu on **New session**:

- the current workspace (default, ⏎)
- each recent workspace
- "Open folder…" → native picker, which **adds** a workspace rather than
  replacing the current one

Then the home screen composes against the chosen folder, and
`createSession(chosenPath, …)` — which already accepts any path — spawns
there.

Files: `src/features/sessions/Sidebar.tsx`,
`src/features/home/WorkspaceHome.tsx`, `src/stores/workspaces.ts`.

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
- two workspaces, one session each → both listed, both groups visible
- start a session in workspace B while A is streaming → A keeps streaming
  (assert its dot stays live), B renders its own tree and git chips
- switch back to A → A's open editors and terminal tabs return, not B's
