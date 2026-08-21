# Worktrees

pidex sessions are tied to their cwd (pi records sessions under
`~/.pi/agent/sessions/<mangled-cwd>/`), so a git worktree is the natural unit
of parallel work: each task gets its own checkout, its own sessions, its own
sidebar group.

## Decisions

- **Location**: `<repo>/.pidex/worktrees/<name>`, ignored via
  `.git/info/exclude` (appended idempotently; tracked files never touched).
  In-repo keeps worktrees discoverable and the sidebar group name meaningful
  (groups key on cwd basename).
- **The main tree's checkout may be changed, but only deliberately and only
  when it is safe.** _This reverses the original rule that pidex would never
  run `git checkout` in the main tree._ The reversal was requested so the
  branch picker matches Claude Desktop, where unticking "worktree" means the
  branch opens in the checkout you already have. The safety the old rule
  provided now lives in guards instead: `checkoutBranch` refuses on any
  uncommitted change, and refuses when another worktree holds the branch
  (naming which one). The default is still isolation — the "worktree" checkbox
  starts ticked.
- **Nothing uncommitted is lost silently.** Dirty worktrees refuse removal
  until the user checks an explicit "discard N changes" box; branch deletion
  is only ever `git branch -d` (unmerged branches survive with the error
  shown); a dirty tree refuses checkout, pull, and update-from-main alike.
- **Merges are guided, not magic**: commit (user-typed message) → preflight
  (main tree clean; no auto-stash/checkout) → `git merge --no-ff`; conflicts
  abort immediately so the repo is never left mid-merge.
- **Pulling is fast-forward only.** `git:pull` runs `merge --ff-only`, so a
  one-click Pull can never write a merge commit or drop the user into a
  conflicted tree. Diverged branches are reported as diverged and sent to a
  manual merge. Bringing a worktree up to date with trunk
  (`git:updateFromMain`) _is_ a real merge, because a worktree with its own
  commits has diverged by definition — it aborts on conflict.
- **The remote is fetched, not assumed.** Ahead/behind used to be measured
  against whatever `refs/remotes/*` happened to be on disk, so a repo nobody
  had fetched reported "up to date" indefinitely. `git:fetch` runs
  `fetch --prune` on workspace open and on branch-menu open, throttled to once
  per 3 minutes per repo and deduped in flight. It never throws: offline, no
  remote, and no credentials are ordinary states.
- **realpath parity**: worktree paths are compared via `realpathSync.native`
  (`normalizeRealPath`), matching pi's cwd mangling in `pi-paths.ts`.

## Surfaces

There is **one** branch control, in the window's top bar
(`src/app/TopBar.tsx`). It replaced three overlapping ones — the home
composer's chip, the chat header's git chip, and the sidebar group menu — which
could each answer "which branch will this run on?" differently and none of
which was visible from the others.

| Operation                                         | Top-bar branch control      | Sidebar group menu     |
| ------------------------------------------------- | --------------------------- | ---------------------- |
| Search all branches                               | ✓                           |                        |
| Switch workspace (main / worktree)                | ✓                           |                        |
| Open a branch as a worktree                       | ✓ (checkbox ticked)         |                        |
| Check a branch out in the main tree               | ✓ (checkbox unticked)       |                        |
| Create worktree (new branch, chosen base)         | ✓                           |                        |
| Pull trunk when behind the remote                 | ✓ (row appears when behind) |                        |
| Update a worktree from trunk                      | ✓ (row appears when behind) |                        |
| Remove worktree (dirty guard, force, `-d` branch) | ✓ (row ✕)                   | ✓                      |
| Merge branch into main (guided)                   | ✓ (worktree sessions)       | ✓                      |
| Prune stale worktrees                             | ✓ (when any prunable)       |                        |
| New session in worktree                           | ✓ (switch, then compose)    | ✓ ("New session here") |

The home composer no longer picks a start target: a session starts in whatever
workspace is open, and the top bar is what changes that.

## Code map

- `electron/fs/git-worktrees.ts` — worktree lifecycle (execFile, no shell);
  `parseWorktreeList` is pure. `listBranches` enriches each branch with
  upstream tracking and distance from trunk in two `for-each-ref` calls —
  deliberately two, because `%(ahead-behind:)` is git 2.41+ and an unknown atom
  fails the whole command, which would cost older git the pull prompt as well.
- `electron/fs/git-sync.ts` — fetch (throttled), fast-forward pull,
  update-from-trunk, and main-tree checkout. Result unions, not throws, for
  expected refusals.
- IPC: `git:listWorktrees / listBranches / addWorktree / removeWorktree /
pruneWorktrees / commitAll / mergeBranch / fetch / pull / updateFromMain /
checkoutBranch` (`shared/ipc.ts`, `electron/ipc/git-handlers.ts`, mocks in
  `src/dev/mockPidex.ts`).
- `src/stores/worktrees.ts` — `byRepo[repoPath]` cache of worktrees/branches
  plus fetch bookkeeping, and the global `preferWorktree` checkbox state.
- UI: `src/features/worktrees/BranchControl.tsx` (top-bar chip + popup),
  `BranchPicker.tsx` (the shared body: search, checkbox, rows, actions),
  `RemoveWorktreeModal.tsx`, `MergeWorktreeModal.tsx`, `PrRow.tsx`;
  sidebar group context menu in `src/features/sessions/Sidebar.tsx`.
- Worktree detection for arbitrary cwds: `GitInfo.isWorktree/mainRepoPath`
  from `git rev-parse --absolute-git-dir --git-common-dir`
  (`electron/fs/git-info.ts`), also shown in sidebar row subtitles.

## Tests

- `electron/fs/__tests__/git-worktrees.test.ts` and `git-sync.test.ts` run
  **real git** in mkdtemp repos; the sync suite clones a local "remote" so
  fetch/pull/ff-only refusal are exercised for real.
- `e2e/smoke.spec.ts` "worktree flow": git-init a scratch workspace → create
  `task-1` from the top-bar control → session starts in the worktree → sidebar
  group `task-1` appears → the control shows the worktree. The pi stub needs no
  changes — it derives its session dir from `process.cwd()`.
