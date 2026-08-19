# 06 — Terminal

Full PTY terminal pane, independent from the agent (agent `bash` tool calls render in chat, not here).

- node-pty in main process; xterm.js in renderer; per-OS default shell (`$SHELL` on mac/linux, PowerShell on Windows); cwd = workspace root.
- Multiple tabs; rename; close; kill on app quit (clean SIGHUP/SIGTERM).
- Theme-matched colors (light/dark switch live), font from settings, ligature-capable mono font.
- Addons: fit (resize-aware with pane dragging), web links (clickable), search (Cmd/Ctrl+F within pane), clipboard (copy on select optional, paste).
- Scrollback configurable (default 10k lines). Main also keeps a bounded
  (256 KB) output tail per PTY and replays it over `pty:attach`, because
  closing the pane disposes the xterm while the shell keeps running — without
  the replay, reopening shows a blank pane in front of a live shell.
- The pane is **per session**: terminals belong to the session that opened them
  (spawned in its cwd), and so does the right-pane selection itself. A terminal
  opened in one session must not appear — or auto-spawn a second shell — when
  you switch to another.
- A shell that cannot start is a first-class UI state, not a silent hang: the
  pane shows the spawn error with a retry. (See `electron/pty/spawn-helper.ts`
  for the node-pty `spawn-helper` trap that made this necessary.)
- **"Run in terminal"** affordance on chat code blocks pipes the command into the active terminal tab (focus + paste, do not auto-execute — leave the newline to the user).
- Used by onboarding: "open a terminal running `pi` to log in" ([08-sessions.md](08-sessions.md)).
