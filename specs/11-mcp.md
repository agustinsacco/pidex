# MCP (Model Context Protocol)

pi core deliberately excludes MCP; it arrives via the `pi-mcp-adapter`
package (declared in pi settings.json `packages`). MCP tools reach the chat
as ordinary `tool_execution_*` events, so the transcript needs nothing
special — pidex's job is **config management and status surfacing**.

## Config chain (adapter-documented, lowest → highest)

| Scope        | File                                                               |
| ------------ | ------------------------------------------------------------------ |
| `xdg`        | `$XDG_CONFIG_HOME/mcp/mcp.json` (default `~/.config/mcp/mcp.json`) |
| `agents`     | `~/.agents/mcp.json`                                               |
| `agents-dir` | `~/.agents/mcp/mcp.json`                                           |
| `pi-global`  | `~/.pi/agent/mcp.json` (honors `PI_CODING_AGENT_DIR`)              |
| `project`    | `<workspace>/.mcp.json`                                            |
| `pi-project` | `<workspace>/.pi/mcp.json`                                         |

Shape: `{"mcpServers": {name: {url | command+args+env, directTools?, disabled?}}}`.
Later files win per server name; pidex records shadowed scopes.

## Rules

- **Renderer sends scope enums, never paths** — path resolution lives in
  `electron/pi/mcp-config.ts` only. Writes are limited to `pi-global` /
  `pi-project` for new servers; disable/remove target the server's own file.
- Malformed files are surfaced (never overwritten by structured writes); a
  raw JSON escape-hatch editor covers repair, and validates JSON on save.
- Structured mutations preserve unknown keys (mutate the parsed object).
- Exactly one of `url` / `command` per server; names refuse path separators.

## Status honesty

There is no structured per-server liveness source. The tab shows:

1. **Installed** — read from `packages:list` (per-scope; pi loads both, so
   the merged settings view would misreport). One-click install runs
   `packages:run` — pi's own package manager, streamed — with a "restart
   sessions to apply" note. Full package management: [12-extensions.md](12-extensions.md).
2. **Session line** — the adapter's `setStatus` footer text for the active
   session, ANSI-cleaned, labeled as adapter-reported.
3. **Cached tools** — `~/.pi/agent/mcp-cache.json`, parsed tolerantly,
   labeled "cached".

## Code map

- Types: `shared/mcp.ts`. Main: `electron/pi/mcp-config.ts` (injectable dirs
  for hermetic tests: `electron/pi/__tests__/mcp-config.test.ts`).
- IPC: `mcp:readConfigs / upsertServer / removeServer / setDisabled /
readCache / readFile / writeFile` (`electron/ipc/mcp-handlers.ts`).
- UI: Settings → MCP (`src/features/settings/tabs/McpTab.tsx`): adapter
  card, resolved server rows (scope badge, enable toggle, cached tool
  disclosure, directTools, shadow notes), add/edit form, chain file list
  with raw editor. Mock cases in `src/dev/mockPidex.ts`.
- E2E: `e2e/smoke.spec.ts` "MCP settings" — seeds `agentDir/mcp.json`,
  asserts the resolved row, toggles disable (file gains `"disabled": true`),
  adds a project server (`.pi/mcp.json` written).
