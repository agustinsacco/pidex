# 2026-08-20 — Sidebar: the pending-row gap reopened

Follow-up to the 2026-08-10 pending-row fix. Reported live: start a session in
a workspace with no prior history and the sidebar shows "Sessions you start
will show up here" for the entire length of a slow first turn, even though the
session is visibly active in the main pane.

The 2026-08-10 fix derived `pendingByWorkspace` from `live` entries with **no
`diskPath`**, on the assumption that `diskPath` becoming known (via
`get_state`) and the session's row becoming visible in `disk` (via the
session-dir watcher) land at roughly the same time. They don't: `get_state`
resolves as soon as pi answers the RPC call, independently of when pi actually
flushes the file and independently of the watcher's `awaitWriteFinish` +
debounce picking it up. For a slow first turn, `diskPath` can be known within
the first second while the disk scan takes much longer — the placeholder
dropped at second one, the real row didn't land until the turn finished, and
the sidebar sat on the empty-state copy for the whole gap.

Fixed by gating on the path actually appearing in `disk` instead of on
`diskPath` being merely known, and by keying the pending map through the
group's `paths` (not the raw `workspacePath`) so a live session in a worktree
folded into its main repo's group still finds its placeholder — the original
Map lookup would have missed it the same way once `groupSessionsByProject`
(2026-08-19) started folding worktrees into a different representative key.
Extracted the computation into `pendingSessionsByGroup` in
`features/sessions/groupSessions.ts`, alongside `groupSessionsByProject`.

Coverage: 4 unit tests, including the exact regression (`diskPath` known, not
yet in `disk` → still pending) that the mock harness can't exercise — its
`get_state` never returns a `sessionFile`, so a live session there is
permanently pending and never reaches the "known but not yet scanned"
transition. The e2e stub writes its session file synchronously at process
start for the same reason: neither fixture can reproduce this gap, which is
how it shipped unnoticed.
