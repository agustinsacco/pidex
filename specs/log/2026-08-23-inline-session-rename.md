# 2026-08-23: Inline session rename on double-click

## Why

Renaming a session launched a modal (`promptText`) from two popovers — the
sidebar row's right-click context menu and the session header kebab. That felt
heavy for such a common action, and renaming a *sidebar row by name* is a
natural inline edit (same idiom the terminal tabs already use).

## What changed

- Double-clicking a session row in the sidebar swaps the title for an inline
  input, pre-filled with the current name. Enter/blur applies, Escape cancels,
  empty/same name is a no-op. Follows the terminal tab pattern.
- `applySessionRename(sessionId, name)` is a new prompt-free sibling of
  `renameSession` — it does the `set_session_name` RPC + `patchMeta` and
  returns whether it succeeded. `renameSidebarSession` now takes the new name
  as an argument instead of prompting.
- Removed `Rename…` from the sidebar row's right-click context menu.
- Removed `Rename session…` from the session header kebab menu
  (`SessionMenu.tsx`, the "session settings popover").

## Not touched

- The composer `/name` command still routes through the modal `renameSession`
  (it has no natural inline home, and the request targeted the popovers).
  Flag if it should go too.