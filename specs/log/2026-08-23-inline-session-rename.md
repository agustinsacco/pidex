# 2026-08-23: Inline session rename on double-click

## Why

Renaming a session launched a modal (`promptText`) from two popovers — the
sidebar row's right-click context menu and the session header kebab. That felt
heavy for such a common action, and renaming a _sidebar row by name_ is a
natural inline edit (same idiom the terminal tabs already use).

## What changed

- Double-clicking a session row in the sidebar swaps the title for an inline
  input, pre-filled with the current name and pre-selected. Enter/blur applies,
  Escape cancels, empty/same name is a no-op. Follows the terminal tab pattern.
- While the editor is up the row renders as a `<div>` rather than a `<button>`:
  a text field inside a button is invalid HTML (announced as one button with an
  unlabelled field inside it, and Enter/Space inside the field are the button's
  to claim). The neutral tag also removes the need to suppress the row's own
  handlers — no `renaming ? undefined : open`, no stopPropagation on the input.
- The commit rule lives in `committedRename(draft, current)`
  (`src/features/sessions/inlineRename.ts`, unit-tested): blur fires for
  reasons the user never meant as an edit, so whitespace-only and unchanged
  drafts resolve to "send nothing".
- `applySessionRename(sessionId, name)` is a new prompt-free sibling of
  `renameSession` — it does the `set_session_name` RPC + `patchMeta` and
  returns whether it succeeded. `renameSidebarSession` now takes the new name
  as an argument instead of prompting.
- Removed `Rename…` from the sidebar row's right-click context menu.
- Removed `Rename session…` from the session header kebab menu
  (`SessionMenu.tsx`, the "session settings popover").

## Tests

- `e2e/smoke.spec.ts` grew a test for the whole flow: real dblclick, real click
  into the field, real keystrokes (not `fill()`, which focuses the element
  itself and would pass even if the row swallowed the click), then Enter, then
  Escape on a second edit. Confirmed to fail when the commit is neutered and
  when the rename does not persist.
- That required the pi stub to answer `set_session_name` the way pi does — by
  appending a `session_info` entry to the session file. It previously fell
  through to the default `success: true`, so a rename left no trace on disk and
  the sidebar (which reads names from disk) reverted on the next refresh.
- The `right-clickable row` regression test asserted on the now-removed
  `Rename…` item; it asserts on `Fork (new branch session)` instead, which is
  equally `SessionRow`-only (`PendingSessionRow` has no context menu at all).

## Not touched

- The composer `/name` command still routes through the modal `renameSession`
  (it has no natural inline home, and the request targeted the popovers).
  Flag if it should go too.
