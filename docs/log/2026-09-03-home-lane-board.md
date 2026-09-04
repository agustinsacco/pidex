# The home screen becomes a lane board

2026-09-03

Home now shows this project's lanes in columns named for what they need from
you, with a ledger of what running them all costs underneath.

## Why not the fleet cards again

[2026-09-03-remove-orchestration.md](2026-09-03-remove-orchestration.md) deleted
the session cards along with the fleet hub, and the gap it left is real: the
sidebar sorts by recency, which is the one ordering that never answers "what do
I do next". A lane whose checks went green an hour ago sinks below one that
printed a log line a minute ago.

The cards needed a continuous feed of phase, last line and current tool for
every session at once — which is what the hub was. The board deliberately needs
none of that. Every column comes from state the renderer already holds:

| Column         | Derived from                                        |
| -------------- | --------------------------------------------------- |
| Waiting on you | `useExtensionUiStore.dialogs`                       |
| Ready to merge | `gh:prsForRepo` — OPEN, checks green, not rejected  |
| Needs a push   | failing checks, changes requested, or behind main   |
| In review      | an open PR whose checks are still running, or DRAFT |
| Running        | the chat store's `isStreaming`                      |

So the board renders with zero live sessions, survives a restart, spends no
tokens, and adds no main-process state. A lane matching nothing is idle and is
counted rather than drawn.

`useLaneBoard` is a hook, not a store, on purpose. Five stores already own one
of these facts each; a sixth copy is the mistake the hub made.

## The ledger

Two facts that belong to no single lane, which is why the sidebar cannot show
them: project spend, and the account window that will stop you first. The
window comes from the Claude provider's own `claude-rate-limit` status, read
across live sessions — the limit is per account, so `bindingRateLimit` takes
the highest utilization rather than the first reading, because a session that
has not taken a turn since the window rolled reports a stale one.

Live-process memory is labelled `~` and derived from the measured ~200 MB per
`pi --mode rpc`. It is an estimate and says so.

## Actions

The card buttons reuse existing flows rather than adding new ones: Merge opens
`MergeWorktreeModal` (it already handles a dirty worktree, the commit step and
the failure paths), Update calls `worktrees.updateFromMain`, and Answer/Open
both call `openDiskSession` — a question renders on the session that asked it,
so opening the lane is what puts it on screen.

## One thing that nearly shipped wrong

Gating `ready` on green checks alone dropped a half-green PR off the board
entirely: not mergeable, not broken, so no column claimed it. A lane went quiet
at exactly the moment it was closest to landing. That is what `review` is for.
