# specs/log

One dated write-up per shipped change, for work that isn't advancing a numbered
phase in [../TRACKER.md](../TRACKER.md) — which is most day-to-day fixes and
features now that P0–P14 have landed.

New entry: `YYYY-MM-DD-slug.md`, dated the day the work shipped, with a
top-level `#` heading that reads like the change. Write down what broke and
_why_, not just what was edited — most of these exist because the cause was
non-obvious.

These were appended to the end of `TRACKER.md` until 2026-08-20. They all
landed at the same spot in one shared file, so two PRs open at once conflicted
there even when their code never overlapped; a new file per change has nothing
to collide with.

| Date       | Entry                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 2026-08-10 | [QoL pass: popovers, attachments, GitHub, theme, icons, skeletons](2026-08-10-qol-pass.md)              |
| 2026-08-10 | [Sidebar identity: worktree names and pending session rows](2026-08-10-sidebar-identity.md)             |
| 2026-08-10 | [Worktrees never take the default branch](2026-08-10-worktrees-default-branch.md)                       |
| 2026-08-11 | [Continuous releases and in-app auto-update](2026-08-11-continuous-releases.md)                         |
| 2026-08-19 | [Sidebar groups sessions by project, not by worktree folder](2026-08-19-sidebar-groups-by-project.md)   |
| 2026-08-19 | [Terminal: the shell that never started, and panes that followed you](2026-08-19-terminal-shell-fix.md) |
| 2026-08-19 | [Symmetric transcript spacing: one step at every boundary](2026-08-19-symmetric-transcript-spacing.md)  |
| 2026-08-20 | [Sidebar: the pending-row gap reopened](2026-08-20-sidebar-pending-row-reopened.md)                     |
| 2026-08-20 | [Releases that actually ship, and a window that fits Linux](2026-08-20-releases-and-linux-window.md)    |
| 2026-08-20 | [The installer 404'd, and self-update had never once run](2026-08-20-installer-arch-and-updater-esm.md) |
