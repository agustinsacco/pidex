# MCP (Model Context Protocol)

pi core deliberately excludes MCP; it arrives via the `pi-mcp-adapter`
package (declared in pi settings.json `packages`). MCP tools reach the chat
as ordinary `tool_execution_*` events, so the transcript needs nothing
special — pidex's job is **config management and status surfacing**.

## Connectors (Settings → Connectors)

The surface a user actually connects a service from. Six curated OAuth
connectors — Linear, Notion, Braintrust, Datadog, Fellow, Slack — each with the
endpoint checked against the vendor's docs, because a wrong URL fails as
"broken auth" (`src/features/connectors/catalog.ts`; endpoints and their
gotchas are documented per entry there).

Three rules hold this together:

1. **pidex never holds a connector token.** The adapter does PKCE, dynamic
   client registration, a loopback callback on `localhost:19876/callback` and
   token custody in the OS credential store. pidex writes `mcp.json` and
   nothing else. Two copies of a refresh token means one is always stale.
2. **Auth is actuated by the adapter's own command.** `Sign in` sends
   `{type:'prompt', message:'/mcp-auth <server>'}`. pi runs extension commands
   immediately without an LLM call, so connecting spends **no tokens**. Disconnect
   is `/mcp logout`, reconnect is `/mcp reconnect`. Deep-importing the adapter's
   auth module is not an option: only `./oauth` (read tokens) is in its
   `exports` map, and the package is versioned independently of pidex.
3. **pidex never auto-answers the adapter's authorization prompt.** The adapter
   asks for the callback URL through `ctx.ui.input`, and pidex claims that
   request (`stores/extensionUi.ts` → `stores/connectors.ts`), opens the
   browser and shows a card. pi's RPC has **no server→client cancel**, so when
   the loopback callback wins the race the adapter abandons its prompt silently
   — and an empty or cancelled answer sent "to tidy up" wins that race instead
   and throws `OAuth authentication cancelled`, killing a flow that already
   succeeded. A pending request is left pending; only an explicit user Cancel
   answers it. The interception is global, not scoped to Settings, because the
   adapter also auto-authenticates mid-turn when a model calls a tool whose
   server has no token.

Slack is the one connector that cannot be one click: it does not support
dynamic registration, so its row takes a client id/secret and writes an
`oauth.redirectUri` that must match what was registered in the Slack app —
which also pins the callback port (`MCP_OAUTH_CALLBACK_PORT` overrides it).

## Per-server status

`pi-ext/mcp-status.ts` forwards the adapter's `pi-mcp-adapter/status/v1`
snapshots to the renderer under status key `pidex-mcp-status`
(`src/features/connectors/mcpStatus.ts`). That is the only structured source of
per-server state: connected / needs-auth / failed / cached / disabled /
not-connected, plus tool and resource counts. It needs a live session, since
the adapter runs inside one — with no session the connector rows show no state
rather than a guess, and the tab says so.

The session footer renders it as a chip (`MCP 2/3 · 48 tools`) that opens
Settings → Connectors; the context meter attributes MCP schema cost per server.

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

There is no structured per-server liveness source **other than the status
extension above**, and that requires a live session. Without one the MCP tab
shows:

1. **Installed** — read from `packages:list` (per-scope; pi loads both, so
   the merged settings view would misreport). One-click install runs
   `packages:run` — pi's own package manager, streamed — with a "restart
   sessions to apply" note. Full package management: [12-extensions.md](extensions.md).
2. **Session line** — the adapter's `setStatus` footer text for the active
   session, ANSI-cleaned, labeled as adapter-reported.
3. **Cached tools** — `~/.pi/agent/mcp-cache.json`, parsed tolerantly,
   labeled "cached".

## Code map

- Types: `shared/mcp.ts`. Main: `electron/pi/mcp-config.ts` (injectable dirs
  for hermetic tests: `electron/pi/mcp-config.test.ts`).
- IPC: `mcp:readConfigs / upsertServer / removeServer / setDisabled /
readCache / readFile / writeFile` (`electron/ipc/mcp-handlers.ts`). The
  connector flow adds **no** IPC: it drives pi over the existing
  `piCommand` path and opens browsers through `app:openExternal`.
- Connectors: `src/features/connectors/` (`catalog.ts`, `oauthPrompt.ts`,
  `mcpStatus.ts`), `src/stores/connectors.ts`,
  `src/features/settings/tabs/ConnectorsTab.tsx`, `pi-ext/mcp-status.ts`.
- UI: Settings → MCP (`src/features/settings/tabs/McpTab.tsx`): adapter
  card, resolved server rows (scope badge, enable toggle, cached tool
  disclosure, directTools, shadow notes), add/edit form, chain file list
  with raw editor. Mock cases in `src/dev/mockPidex.ts`.
- E2E: `e2e/smoke.spec.ts` "MCP settings" — seeds `agentDir/mcp.json`,
  asserts the resolved row, toggles disable (file gains `"disabled": true`),
  adds a project server (`.pi/mcp.json` written). "Connectors" — adds Datadog
  on the EU site and asserts the written endpoint, since a per-site host that
  silently defaults to US authorizes and then returns nothing.
