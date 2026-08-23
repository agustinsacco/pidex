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

| Date       | Entry                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-08-10 | [QoL pass: popovers, attachments, GitHub, theme, icons, skeletons](2026-08-10-qol-pass.md)                    |
| 2026-08-10 | [Sidebar identity: worktree names and pending session rows](2026-08-10-sidebar-identity.md)                   |
| 2026-08-10 | [Worktrees never take the default branch](2026-08-10-worktrees-default-branch.md)                             |
| 2026-08-11 | [Continuous releases and in-app auto-update](2026-08-11-continuous-releases.md)                               |
| 2026-08-19 | [Sidebar groups sessions by project, not by worktree folder](2026-08-19-sidebar-groups-by-project.md)         |
| 2026-08-19 | [Terminal: the shell that never started, and panes that followed you](2026-08-19-terminal-shell-fix.md)       |
| 2026-08-19 | [Symmetric transcript spacing: one step at every boundary](2026-08-19-symmetric-transcript-spacing.md)        |
| 2026-08-20 | [Sidebar: the pending-row gap reopened](2026-08-20-sidebar-pending-row-reopened.md)                           |
| 2026-08-20 | [Releases that actually ship, and a window that fits Linux](2026-08-20-releases-and-linux-window.md)          |
| 2026-08-20 | [The installer 404'd, and self-update had never once run](2026-08-20-installer-arch-and-updater-esm.md)       |
| 2026-08-20 | ["UI scale" that never scaled, and a dead strip above the sidebar](2026-08-20-ui-scale-and-linux-titlebar.md) |
| 2026-08-20 | [Provider errors show the sentence, not the JSON](2026-08-20-provider-error-envelopes.md)                     |
| 2026-08-20 | [A type scale, replacing 424 hand-picked pixel sizes](2026-08-20-type-scale.md)                               |
| 2026-08-20 | [You could not copy out of the terminal](2026-08-20-terminal-clipboard.md)                                    |
| 2026-08-20 | [Extensions management + first-run onboarding](2026-08-20-extensions-phase01-settings-audit.md)               |
| 2026-08-20 | [Per-extension settings tabs: Claude Code + Web access](2026-08-20-per-extension-settings-tabs.md)            |
| 2026-08-20 | [E2E coverage for the extensions surface](2026-08-20-extensions-e2e-coverage.md)                              |
| 2026-08-21 | [The composer that wouldn't grow with its text](2026-08-21-composer-autogrow.md)                              |
| 2026-08-21 | [Claude Code provider: four gap fixes, live-verified](2026-08-21-claude-cli-provider-fixes.md)                |
| 2026-08-21 | [Rendering Claude Code provider transcripts properly](2026-08-21-claude-cli-transcript-rendering.md)          |
| 2026-08-21 | [Cleanup, part 1: foundations and the git layer](2026-08-21-cleanup-foundations-and-git-layer.md)             |
| 2026-08-21 | [Presentation primitives](2026-08-21-presentation-primitives.md)                                              |
| 2026-08-21 | [One top bar, one branch control](2026-08-21-top-bar-and-branch-control.md)                                   |
| 2026-08-22 | [Sidebar density, resizable width, per-group "+"](2026-08-22-sidebar-density-and-resize.md)                   |
| 2026-08-22 | [Auto-named sessions, unboxed activity, sub-agent rendering](2026-08-22-chat-polish-and-auto-naming.md)       |
| 2026-08-22 | [What's in the context window, and what's left of the account](2026-08-22-context-and-account-visibility.md)  |
| 2026-08-22 | [Chat images open on click and copy on right-click](2026-08-22-chat-image-open-copy.md)                       |
| 2026-08-22 | [Worktree sessions that read the main checkout](2026-08-22-worktree-path-leak.md)                             |
| 2026-08-23 | [Signing into subscription providers without leaving the app](2026-08-23-subscription-accounts.md)            |
