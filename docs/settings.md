# 09 — Settings

Settings window (Cmd/Ctrl+,), tabbed:

## Appearance

- Theme: Light / Dark / System (live switch across app, Monaco, xterm, Shiki, Mermaid).
- Font sizes: UI scale, chat, editor, terminal. Mono font picker (bundled options).

## Agent (writes pi's `settings.json` — global, with per-workspace override toggle writing `<ws>/.pi/settings.json`)

- Default model + provider (choices from `get_available_models` when a session is live, else parse `models.json` + known providers).
- Default thinking level; `hideThinkingBlock`.
- Steering / follow-up modes ("all" vs "one-at-a-time").
- Compaction: enabled, reserveTokens, keepRecentTokens. Retry: enabled, maxRetries, baseDelayMs.
- Note in UI: changes apply to new sessions (pi reads settings at spawn).

## Workspaces

- **New sessions**: whether a chat gets its own branch and worktree, and the
  branch prefix (`WorktreePrefs`).
- **Naming and markers**: auto-naming on/off, the word range and character cap
  for generated titles, the branch-slug cap, and the lane marker mode
  (`LanePrefs`). Every number is clamped in both the renderer and main; see
  [lanes.md](lanes.md#preferences) for what each one reaches.
- Recent workspace list management (remove, reorder, clear).
- Per-workspace: default layout reset.

## Advanced

- Raw file editors (Monaco JSON, schema-validated where schemas exist) for `~/.pi/agent/settings.json` and `models.json`, with a "restart sessions to apply" note. Read-only viewer for discovered skills/extensions/prompts (paths + descriptions). Never render `auth.json` contents.
- pi health: detected pi path + version, min supported, re-check.

## Keybindings

- Reference sheet of all app shortcuts (read-only v1), grouped App / Chat / Editor & terminal.

## Connectors and MCP

- **Connectors**: the curated OAuth catalog (Linear, Notion, Braintrust, Datadog, Fellow, Slack) — add, sign in, reconnect, remove. Signing in drives the MCP adapter's own `/mcp-auth` command in a live session; pidex holds no tokens.
- **MCP**: the `mcp.json` resolution chain, custom servers, and raw JSON repair.
- Both are specified in [mcp.md](mcp.md).

pidex's own prefs live in electron-store; pi's config stays in pi's files — the two are never mixed.
