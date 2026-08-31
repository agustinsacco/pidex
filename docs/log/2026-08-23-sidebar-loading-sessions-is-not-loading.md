# 2026-08-23 — Sidebar: "Loading sessions…" is not loading

The sidebar's "Loading sessions…" line was a "not scanned yet" indicator
presented as an in-progress loader, and its contract was wrong in three
concrete ways:

1. **It rendered under real sessions.** `group.scanned` is an AND across every
   folder merged into a project group (main repo + linked worktrees), but the
   session rows are not gated on it. When a worktree hadn't been scanned yet
   (beyond the boot-scan cap, or discovered only after `git:listWorktrees`)
   while the main repo already had rows, the group read `scanned: false` and
   the "Loading sessions…" line appeared directly below actual sessions —
   "loading what? I can see them."
2. **A failed scan pinned it forever.** `scanned` was derived only from `path
in disk`, i.e. _successful_ writes. `refreshDisk` threw → nothing entered
   `disk` → `scanned` stayed false → the label rendered indefinitely, with no
   retry and no self-heal. `refreshAllDisk` swallowed per-workspace failures
   via `Promise.allSettled`.
3. **The active workspace's group is force-open before its scan**, so when
   there are more than eight known workspaces the group you're looking at
   could show the line at every boot.

## What "Loading sessions…" is for (kept)

The lazy boot-scan is deliberate: `refreshAllDisk` caps the cold-start scan at
8 workspaces so first paint isn't blocked by unbounded directory walks, and
groups beyond the cap stay collapsed until expanded, which triggers their
first scan. Unscanned groups render a header (not hidden) so their sessions
stay reachable. That design is fine and untouched; the label's _contract_ was
the bug.

## Fix

Separate **"has been scanned (attempted)"** from **"has results"**, and only
show a status line when the group is genuinely empty.

- `shared/models.ts`: new `SessionScanStatus = 'ok' | 'error'`; absence in the
  record means _never attempted_.
- `src/stores/sessions.ts`: new `scanStatus` on the store. `refreshDisk` /
  `refreshAllDisk` now record `'ok'` on success and `'error'` on a thrown
  scan, and never let failure masquerade as "scanned". `refreshAllDisk` was
  rebuilt to capture each `path` explicitly (a rejected inner promise used to
  drop the `{ path, metas }` wrapper — `allSettled`'s `reason` carries no
  path, so per-workspace status was impossible to record).
- `src/features/sessions/groupSessions.ts`: `GroupedSessions` gains
  `attempted` (every merged folder has had ≥1 scan attempt, AND-ed) and
  `errored` (any folder's latest attempt threw, OR-ed). The original `scanned`
  (successful, in `disk`) is kept — the collapse-default and the
  "keep unscanned groups reachable" filter still need it.
- `src/features/sessions/Sidebar.tsx`: the status line is now gated on
  `group.metas.length === 0 && !pending` **first**, so rows and a status line
  can never coexist. When the group is empty it picks, in order:
  - attempt still pending → "Loading sessions…"
  - attempted with a failure → "Couldn't load sessions" + a Retry button that
    re-runs the scan across every folder in the group (the resolution path)
  - attempted clean → "Sessions you start will show up here"

## Coverage

- `groupSessions.test.ts`: attempted stays `false` until _every_ merged folder
  has scanned (mixed scanned / not-yet-scanned worktree group still reads as
  loading, never as definitively empty); `errored` is set once a merged
  folder's scan throws even when a sibling succeeded.
- `sessions.test.ts`: `refreshDisk` records `'ok'` + metas on success and
  `'error'` (leaving `disk` untouched) on a throw; `refreshAllDisk` records
  per-workspace status under mixed success/failure.

Existing `scanned`-based collapse and reachability behavior is unchanged; the
full unit suite (955 tests), typecheck, eslint, and prettier all pass.

## Amendment, 2026-08-28

"Groups beyond the cap stay collapsed until expanded" was recorded above as
intended behaviour. It is not sufficient, and the gap it left is the subject
of [2026-08-28-sidebar-lane-scan.md](2026-08-28-sidebar-lane-scan.md): the cap
is **by list position**, lanes are appended last, and the session-dir watcher
runs with `ignoreInitial: true` — so a lane inside an **already expanded**
group was never scanned by anything. Only `toggleGroup` scanned a whole group,
which is why collapsing and re-expanding was the workaround users found.

`refreshMissing` now backfills an expanded group's unscanned folders,
uncapped. The cap itself stays, and still governs collapsed groups.

The collapse default described here also changed. It keyed off `scanned`,
which is AND-ed across the group, so one late-discovered lane flipped an open
group shut. It keys off `anyScanned` now.
