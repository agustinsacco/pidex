# Lanes

A **lane** is one unit of work: a session, the branch it runs on, the worktree
that branch is checked out in, and the pull request it becomes. pidex shows all
four on a single sidebar row, and this document is the contract for that row.

Related: [orchestration.md](orchestration.md) for how lanes are supervised,
[extensions.md](extensions.md) for the artifact tools a lane can call.

## The row

```
● 🚀  Give Me The Text Here
      9m · wt · give-me-the-text-here · ±2 · $1.17          #418 ✓✓
```

Five parts, each owned by a different module:

| part          | source                      | note                                                            |
| ------------- | --------------------------- | --------------------------------------------------------------- |
| indicator dot | `SessionIndicator`          | derived, never stored: streaming > unseen > live > disk         |
| marker        | `lib/laneMarker.ts`         | fixed 18px slot                                                 |
| title         | `lib/sessionTitle.ts`       | live name beats scanned name                                    |
| subtitle      | `sessionSubtitle.ts`        | `·`-joined segments, branch is the only one allowed to truncate |
| PR chip       | `prChip.ts` + `PrBadge.tsx` | right-aligned trailer, **not** a subtitle segment               |

The subtitle and the PR chip are deliberately separate. Segments are joined
with `·` and truncate in order; the chip is `ml-auto` so it forms a scannable
column down the sidebar instead of floating after a branch name whose width
varies per lane.

## Markers

An emoji pinned left of the title. Two rules, and both are about the **column**
rather than the glyph:

1. **The slot is fixed width and always rendered** (unless markers are off
   entirely). A slot that collapses on an unmarked lane shifts every title in
   the list, the left edge goes ragged, and the eye has to re-find the title on
   each row. That is the thing the column exists to prevent.
2. **The fallback is derived, not stored.** `SessionMeta` is scanned out of
   pi's own `.jsonl`; pidex does not own that format and must not add fields to
   it. Explicit choices live in `AppPrefs.laneMarkers` keyed by session path;
   every other lane hashes its **branch**.

Keying on the branch and not the title is load-bearing: pidex names a session
only after its first turn **ends**, so a title-derived marker would change
under the user the moment the auto-namer landed. The branch exists from the
moment the worktree does.

Because the fallback is total, the override map is safe to prune — a dropped
entry degrades a lane to its auto marker, never to a blank row.
`PendingSessionRow` renders the slot too, or the swap to a real row mid-turn
would shift the title.

`LanePrefs.markers` has three values, and the third is not the same as the
second: `auto` derives for everyone, `manual` respects choices and derives
nothing, `off` removes the column and reclaims its width. `off` also wins over
an explicit choice, so turning markers off does not leave the ones you picked
behind.

## PR status

`electron/fs/gh-cli.ts` is the only place pidex shells out to `gh`, and it is
**read-only by design**: no push, no create. Those are outward-facing writes
and belong behind an explicit confirmed action, which is why the `↑ no PR` chip
is inert rather than a one-click create button.

Two queries, and the distinction matters:

- `ghPrForBranch` — one branch. Used by the top-bar branch popup.
- `ghPrsForRepo` — the whole repo, indexed by `headRefName`. Used by the
  sidebar.

**Never fan `ghPrForBranch` across the sidebar.** That is 8-20 subprocesses per
refresh. The batched sibling exists for the same reason `git:info` grew
`git:infoBatch`.

`stores/pullRequests.ts` is keyed by **repo path**, not session: a sidebar
group is exactly one repo, because worktrees fold into their main checkout. A
lane's PR is joined at render time through `gitByCwd[cwd].branch` — `SessionMeta`
has no branch field to hang it on.

Refresh is event-driven (window focus, disk listing change) and only for
**expanded** groups, matching the session-dir watchers. The store coalesces
anything inside `PR_STALE_MS`, so calling `refresh` from several triggers is
free.

Every `gh` failure is a normal state, not an error: not installed, not
authenticated, no GitHub remote. All of them land as an empty map and render as
no chip. Nothing here raises a toast.

### The chip is one token carrying two signals

Colour is PR state; the trailing glyph is the check/review verdict. A second
chip would double the ink on the densest line in the app and truncate the
branch to nothing, and the two are read together in practice ("is it in, and is
it green").

| variant             | meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `open` / `approved` | open, checks green; `✓✓` once a human approved                 |
| `failing`           | checks red. The only state that earns colour at rest           |
| `pending`           | checks still running                                           |
| `blocked`           | green, but changes requested: blocked on a person, not a build |
| `draft`             | neutral. A draft is not a claim on your attention              |
| `merged`            | violet. The "this lane is done" signal                         |
| `closed`            | closed unmerged                                                |

**Terminal states beat check state.** A merged PR whose last run was red is
still merged; colouring it red sends the reader to fix a branch that is already
in.

`--px-merged` exists because in `--px-success`, "merged" and "open and green"
are indistinguishable — and those are the two states the sidebar is scanned to
tell apart. Merged is what makes PR status and bulk delete one feature.

The chip is a `role="link"` span, **not a button**: the row is already a
`<button>` and nesting one is invalid HTML. `tabIndex={-1}` keeps it out of the
tab order, because one focusable chip per lane would double the sidebar's tab
stops. The row context menu's **Open pull request** item is therefore the
keyboard route, not a nicety. The two are a pair.

## Naming

A lane is named once, after its first turn ends, by a one-shot `pi -p` call
(`pi:generateTitle` → `electron/pi/session-naming.ts`). The title then flows to
the branch as well as the session, so the sidebar group, the branch chip and
the title all agree.

Two naming passes must never run for one session. `startChat` owns naming for
chats it creates and passes `autoName: false` to suppress the session store's
own pass.

`titleArgs` strips everything a title does not need — tools, context files,
skills, prompt templates — because the naming call once carried ~35,000 tokens
of harness to produce a 15-token title. **`--no-extensions` is conspicuously
absent**: providers register through extension discovery, so `-ne` makes
`pi-claude-cli` an unknown provider and the run fails outright.

`pi -p` blocks until stdin reaches EOF, so it must never run through
`execFile`. See `electron/pi/print-mode.ts`.

## Preferences

`LanePrefs` in `AppPrefs.lanes`, edited in Settings → Workspaces, stored via
`app:setLanePrefs`.

| pref                            | default | reaches                                  |
| ------------------------------- | ------- | ---------------------------------------- |
| `markers`                       | `auto`  | the sidebar row                          |
| `autoName`                      | `true`  | both naming passes                       |
| `nameMinWords` / `nameMaxWords` | 2 / 5   | the naming prompt                        |
| `nameMaxLength`                 | 60      | `sanitizeTitle`, after the model replies |
| `branchSlugMaxLength`           | 40      | `slugifyTitle`, so branch and folder     |

Branch **prefix** is separate and lives in `WorktreePrefs.branchPrefix`,
alongside the switch that decides whether a chat gets a branch at all. The
split is deliberate: `WorktreePrefs` decides _whether_ a lane gets a branch,
`LanePrefs` decides what the resulting lane _looks like_. A user with worktrees
off still names sessions.

**Every number here is clamped twice**, by `normalizeLanePrefs` in both the
renderer and the main process. Prefs are user-editable JSON and these values
reach a prompt, a git ref and a filesystem path. The renderer clamp is not
redundant: the settings UI reads back the value it just wrote, so an
out-of-range entry has to be corrected locally too or the field and the stored
pref disagree until a reload.

`nameMaxWords` can never fall below `nameMinWords`, or the prompt asks for
"5-2 words".

`LanePrefs` lives in its own leaf store (`stores/lanePrefs.ts`) rather than in
`stores/settings.ts`, which calls `window.matchMedia` at creation time.
Importing that from `stores/sessions.ts` breaks every non-jsdom suite that
touches sessions. Hydration still happens in `settings.ts`, so there is one
prefs round-trip on launch.

## Deleting lanes

Selection is scoped to **one group**, which is one repo. A destructive confirm
spanning two repos is how you delete the wrong branch. The Pinned list mixes
projects and is not selectable at all.

The checkbox **replaces the indicator dot in the same gutter**, so entering
select mode shifts nothing, and it is revealed on hover rather than occupying a
permanent column.

Deleting is three resources, and only the first two default on:

1. the session transcript, to the OS Trash (`shell.trashItem`, recoverable) —
   pi's `.jsonl` **and** its paired Claude Code transcript
2. the worktree directory, gone
3. the branch, `git branch -d` only

**Never escalate to `git branch -D`.** An unmerged branch is kept and reported;
that is not a reason to keep the transcript, so the lane still goes.

**Remote branch deletion is not offered.** No channel exists for it and a bulk
flow is the worst place to introduce the least reversible operation.

### Two tiers of guard

- A **blocker** refuses: a turn in progress. Struck through in the confirm,
  excluded from the count, reported afterwards rather than silently dropped.
- A **warning** is lost work: uncommitted changes, unpushed commits, an open
  PR. These raise **one** acknowledgement for the whole selection. A per-lane
  confirm trains you to click through it, which is how the guard stops working.

Warnings carried only by a _blocked_ lane do not count — it is not being
deleted.

### Ordering, and why it is that way

Per lane: dispose the live session, remove the worktree, then delete the
transcript. Worktree removal is the step that actually fails in practice (a
terminal cwd'd into the lane, a dirty tree), and failing first leaves the lane
whole and still in the sidebar. The other order leaves a transcript in the
Trash and a directory on disk, which is worse than doing nothing.

The loop is **sequential, not `Promise.all`**: each lane disposes a subprocess
and runs git, and N of those at once is how a worktree gets removed while its
own pi is still writing.

Cancellation is checked **between** lanes only. Stopping mid-lane is how you
get a half-deleted one.

### Feedback is not a toast

`stores/sessions.ts` publishes `bulkDelete` progress and `BulkDeleteProgressModal`
renders it. Per-lane outcomes matter: a worktree that would not remove is the
common case and that lane is still in the sidebar. A toast reading "3 deleted"
when four were selected is exactly the silent failure this exists to prevent.
