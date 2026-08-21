# 03 — App Shell, Workspaces, Panes

## Window & chrome

- Native frame conventions per OS (hiddenInset traffic lights on macOS like the screenshots).
- Window title: `workspace · session name`.
- Global shortcuts: Cmd/Ctrl+N new session, Cmd/Ctrl+P fuzzy file finder, Cmd/Ctrl+, settings, Cmd/Ctrl+` toggle terminal pane, Cmd/Ctrl+B toggle sidebar.

### Top bar

A **single full-width bar** (`src/app/TopBar.tsx`) sits above the sidebar, chat, and pane columns: sidebar toggle, workspace chip, branch control ([WORKTREES.md](WORKTREES.md)), session title, then the pane switches and the session kebab.

It is the **only** element allowed in the strip the OS draws window controls in, and therefore the only call site of `.titlebar-inset-end` (right, Windows/Linux overlay) and `.titlebar-inset-start` (left, macOS traffic lights). This is structural, not cosmetic: those insets are `100vw`-relative, so they are only correct on an element that spans the window. Per-column headers cannot know whether they are the one under the OS buttons — when the chat header owned the inset, opening a right-hand pane put that pane's expand/close buttons directly beneath the real close button. Columns must not grow their own title bars.

## Left sidebar (Claude Desktop style)

- **Workspace switcher** at top: current workspace name + dropdown of recent workspaces; "Open Folder…" via native picker. Adding a workspace records it in app prefs.
- **New Session** button (prominent, like the screenshots' "+ New").
- **Session list** for the active workspace: pinned section, then recent, grouped headers supported. Each row: session name (or first-message preview), relative timestamp, running indicator (spinner while streaming; unread/completed badge for background sessions). Context menu: rename, pin, fork, clone, export HTML, delete (trash).
- Settings entry + app identity at the bottom (mirrors the account area in screenshots).
- Collapsible (Cmd/Ctrl+B), width-draggable.

## Pane system

Main area is a **resizable multi-pane layout** with drag handles, persisted per-workspace in app prefs, panes closable/reopenable from a view menu and shortcuts:

1. **Chat pane** — always present ([04-chat.md](04-chat.md)).
2. **Files pane** — explorer tree + open-file tabs with Monaco ([05-files-editor.md](05-files-editor.md)). Opening a file from tree, chat file-chips, or diffs lands here; support split (open to the side).
3. **Terminal pane** — tabbed terminals ([06-terminal.md](06-terminal.md)).
4. **Artifacts pane** — gallery + viewer ([07-artifacts.md](07-artifacts.md)); opens automatically when a session produces its first artifact.

Requirements:

- Drag-to-resize at 60fps (no layout thrash), double-click a handle to reset split.
- Layout persists and restores per workspace; sensible defaults: chat 45% / files 35% / terminal 20% bottom strip; artifacts replaces/joins files region when opened.
- Multiple sessions per workspace run **concurrently**; the chat pane shows the active session; switching sessions is instant (state held in stores keyed by sessionId); background sessions keep streaming into their stores.

## Theming

- Light / Dark / System in settings; theme tokens as CSS variables consumed by Tailwind config, Monaco theme, xterm theme, Shiki theme, Mermaid theme — all switch together, live, no reload.
- Design tokens per [00-overview.md](00-overview.md) brand direction.

## Global surfaces

- **Toasts** (also used by extension `notify`).
- **Status strip** (bottom of chat pane or window): extension `setStatus` entries, pi crash/restart notices, update availability.
- **Command palette** (Cmd/Ctrl+K): app actions (new session, toggle panes, switch workspace/session, theme) — distinct from the chat `/` command menu.
- **Empty states**: no workspace → warm onboarding card with folder picker; no sessions → "Describe a task…" hero reminiscent of the screenshots' greeting; pi missing/outdated → setup screen with install command ([08-sessions.md](08-sessions.md)).
