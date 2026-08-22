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
- **A new chat gets its own branch, named after itself.** Sending the first
  message from the home composer generates the session title, derives a branch
  and folder from it, and starts pi there — one name in three places
  (`src/features/sessions/startChat.ts`). This is why the send button waits a
  couple of seconds: a pi session is bound to the cwd it spawned in, so the
  worktree has to exist first. Every step degrades rather than aborting — a
  naming timeout falls back to the message text, an unreachable remote to
  local trunk, a git refusal to a plain session with the reason shown.
- **Auto-created branches start from `origin/<trunk>`, not local trunk.**
  "Branch off the latest main" is the intent, and a local `main` in a repo
  someone has been working in is routinely stale. Pulling it first would fail
  on a dirty main tree, so pidex fetches (throttled) and branches off the
  remote-tracking ref instead: freshest trunk, main checkout untouched, dirty
  or not. `--no-track` goes with it, or the new branch would take `origin/main`
  as its upstream and read as "behind trunk" forever
  (`startPoint` in `git-worktrees.ts`).
- **The branch prefix is configurable, and one flag governs isolation.**
  `pidex/` by default (Settings → Workspaces, empty allowed). The composer's
  "new branch" checkbox, the branch popup's "worktree" checkbox and the
  settings toggle are one persisted preference — three surfaces asking "does
  my work get its own branch?" that must not be able to disagree. It persists
  now; before, it reset to on at every launch.
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

The home composer still does not pick a start _target_ — that is the top bar's
job. Its one git control is a checkbox that opts the next message out of
isolation, which is a different question ("does this chat need a branch at
all?") and is worth answering per message: a quick question does not deserve
one. Ticked (the default), a new chat branches off trunk even when the open
workspace is itself a worktree, because a new chat means new work. Continuing
on the branch you are looking at is the sidebar's "New session here".

## Code map

- `src/features/sessions/startChat.ts` — the home composer's send path: title
  - fetch in parallel, branch/folder derivation, worktree creation, workspace
    switch, session spawn. Every failure mode degrades to a running session.
- `src/lib/branchName.ts` — pure title → `{folder, branch}` derivation
  (slug, prefix normalization, collision suffixes). Its charset is narrower
  than git's ref rules on purpose, so no result needs re-validating.
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
- `src/lib/branchName.test.ts` covers the derivation, including that no slug it
  can produce is a ref `git check-ref-format` would reject.
- `e2e/smoke.spec.ts` "worktree flow": git-init a scratch workspace → create
  `task-1` from the top-bar control → send a first message → the chat branches
  off trunk into `pidex/stub-session-title` rather than continuing on `task-1`
  → one sidebar group for the project. Its sibling test unticks the composer
  checkbox and asserts nothing is created. The stub answers the naming prompt
  with a fixed title and honours `-n`, which is what makes the branch name
  deterministic; it still derives its session dir from `process.cwd()`.
