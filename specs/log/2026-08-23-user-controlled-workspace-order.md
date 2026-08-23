# 2026-08-23 — Workspace order belongs to the user

The sidebar had three competing most-recently-used orderings. Opening a
workspace moved it to the beginning of the renderer's list, session creation
did the same in persisted preferences, and the grouped sidebar independently
promoted live, active, and recently changed projects. Starting a session or
receiving activity could therefore rearrange the left-hand workspace list.

Workspace order is now the persisted `recentWorkspaces` sequence. Opening an
existing workspace updates its `lastOpenedAt` timestamp for launch recovery
without moving it; a newly chosen folder is appended. The sidebar preserves
that sequence when it creates project groups, rather than sorting by session
activity.

Each workspace group header now has a three-dot menu with **Move up** and
**Move down**. Those choices update both the renderer store and persisted
preferences, and the boundary action is disabled. A linked-worktree group
continues to be represented by its main project, so it remains one movable
sidebar item rather than splitting into branch-specific entries.
