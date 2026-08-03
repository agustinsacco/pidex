# 06 — Terminal

Full PTY terminal pane, independent from the agent (agent `bash` tool calls render in chat, not here).

- node-pty in main process; xterm.js in renderer; per-OS default shell (`$SHELL` on mac/linux, PowerShell on Windows); cwd = workspace root.
- Multiple tabs; rename; close; kill on app quit (clean SIGHUP/SIGTERM).
- Theme-matched colors (light/dark switch live), font from settings, ligature-capable mono font.
- Addons: fit (resize-aware with pane dragging), web links (clickable), search (Cmd/Ctrl+F within pane), clipboard (copy on select optional, paste).
- Scrollback configurable (default 10k lines).
- **"Run in terminal"** affordance on chat code blocks pipes the command into the active terminal tab (focus + paste, do not auto-execute — leave the newline to the user).
- Used by onboarding: "open a terminal running `pi` to log in" ([08-sessions.md](08-sessions.md)).
