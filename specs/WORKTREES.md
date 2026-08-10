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
- **The main tree's checkout is never changed by pidex.** Picking an existing
  branch creates/reuses a worktree for it instead of `git checkout`.
- **Nothing uncommitted is lost silently.** Dirty worktrees refuse removal
  until the user checks an explicit "discard N changes" box; branch deletion
  is only ever `git branch -d` (unmerged branches survive with the error
  shown).
- **Merges are guided, not magic**: commit (user-typed message) → preflight
  (main tree clean; no auto-stash/checkout) → `git merge --no-ff`; conflicts
  abort immediately so the repo is never left mid-merge.
- **realpath parity**: worktree paths are compared via `realpathSync.native`
  (`normalizeRealPath`), matching pi's cwd mangling in `pi-paths.ts`.

## Capability × surface

| Operation                                         | Home branch chip      | Chat header git chip  | Sidebar group menu     |
| ------------------------------------------------- | --------------------- | --------------------- | ---------------------- |
| Pick session target (main / worktree)             | ✓                     |                       |                        |
| Create worktree (new branch, chosen base)         | ✓                     |                       |                        |
| Open existing branch as worktree                  | ✓                     |                       |                        |
| Remove worktree (dirty guard, force, `-d` branch) | ✓ (hover ✕)           |                       | ✓                      |
| Merge branch into main (guided)                   |                       | ✓ (worktree sessions) | ✓                      |
| Open main repo home                               |                       | ✓                     |                        |
| New session in worktree                           | ✓ (target picker)     |                       | ✓ ("New session here") |
| Prune stale worktrees                             | ✓ (when any prunable) |                       |                        |

## Code map

- `electron/fs/git-worktrees.ts` — all git operations (execFile, no shell);
  `parseWorktreeList` is pure. Tests run **real git** in mkdtemp repos:
  `electron/fs/__tests__/git-worktrees.test.ts`.
- IPC: `git:listWorktrees / listBranches / addWorktree / removeWorktree /
pruneWorktrees / commitAll / mergeBranch` (`shared/ipc.ts`,
  `electron/ipc/git-handlers.ts`, mocks in `src/dev/mockPidex.ts`).
- `src/stores/worktrees.ts` — `byRepo[repoPath]` cache of worktrees/branches.
- UI: `src/features/worktrees/BranchWorktreeChip.tsx` (home composer),
  `RemoveWorktreeModal.tsx`, `MergeWorktreeModal.tsx`;
  `src/features/chat/GitChips.tsx` (header `wt` chip + actions); sidebar
  group context menu in `src/features/sessions/Sidebar.tsx`.
- Worktree detection for arbitrary cwds: `GitInfo.isWorktree/mainRepoPath`
  from `git rev-parse --absolute-git-dir --git-common-dir`
  (`electron/fs/git-info.ts`), also shown in sidebar row subtitles.

## E2E

`e2e/smoke.spec.ts` "worktree flow": git-init a scratch workspace → create
`task-1` from the chip → session starts in the worktree → sidebar group
`task-1` appears → header shows the worktree chip. The pi stub needs no
changes — it derives its session dir from `process.cwd()`.
