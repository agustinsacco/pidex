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
2. **Auth is actuated by the adapter's own command,** `/mcp-auth <server>`. pi
   runs extension commands immediately without an LLM call, so connecting
   spends **no tokens**. Disconnect is `/mcp logout`, reconnect is
   `/mcp reconnect`. Deep-importing the adapter's auth module is not an option:
   only `./oauth` (read tokens) is in its `exports` map, and the package is
   versioned independently of pidex.
   There are two routes to that command, and the difference is which process
   runs it:
   - **Headless** (`mcp:authorize`, the default): main spawns a throwaway
     `pi --mode rpc --no-session` (`electron/pi/connector-auth.ts`), drives the
     flow, opens the browser itself, and kills the process when it settles.
     `--no-session` matters twice — no session file appears in the sidebar, and
     the process is never in the registry, so the fleet hub never projects it as
     work. Progress arrives on the `mcp:authState` broadcast. This is what makes
     Settings usable on a fresh launch, which is when people go there.
   - **In-session**: the adapter auto-authenticates mid-turn when a model calls
     a tool whose server has no token, so the same prompt can arrive on a live
     session's extension-UI channel. `stores/extensionUi.ts` routes it to the
     same store and the same card.
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

## The Claude provider reaches MCP through pi, not around it

A `pi-claude-cli` session has **two** possible sources of MCP servers, and only
one of them is pidex's.

1. **pi's chain** (the table below), loaded by the adapter, which registers
   `mcp` / `mcpScript` into pi's tool registry. pi-claude-cli then snapshots
   every non-built-in pi tool into a schema-only MCP server it hands the CLI as
   `--mcp-config`, so the gateway arrives as `mcp__custom-tools__mcp`. The
   schema server answers `initialize` and `tools/list` only: a call is bounced
   back to pi, which executes the real tool and resumes the CLI next turn.
2. **The Claude CLI's own chain** — `~/.claude/.mcp.json`, `~/.claude.json`,
   and the user's claude.ai account connectors. pidex neither writes nor reads
   these.

Servers from (2) are a problem, not a bonus. They never become pi
`tool_execution_*` events (only `mcp__custom-tools__*` does), so
`worktree-paths.ts` cannot guard them; the footer chip and the context meter
both read the adapter, which knows nothing about them; and the same project
behaves differently on two machines. So every Claude-provider spawn gets
`PI_CLAUDE_CLI_STRICT_MCP=1` (`claudeProviderSpawnEnv` in
`electron/pi/provider-detect.ts`), which passes the CLI `--strict-mcp-config`
and drops chain (2) entirely.

Not `PI_CLAUDE_CLI_HERMETIC`: it reaches the same flag but also passes an empty
`--setting-sources`, which drops the CLI's CLAUDE.md auto-memory. pidex already
passes `--no-context-files` so pi omits its own copy, and the pair would leave
the model with project instructions from neither side.

**Requires pi-claude-cli >= 0.5.1.** Older versions ignore the variable and
keep the pre-existing merge. That release also refreshes the schema snapshot
per turn; before it, the tool surface froze at turn 1, so a connector added
mid-session never reached the model until the session restarted.

The gateway is also what keeps a session small: `mcp` + `mcpScript` cost ~3.9KB
of schema no matter how many servers are configured, growing only by the server
names listed in the `mcp` description. `directTools` on a server entry opts out
of that — it promotes that server's tools to flat top-level names, which is
worth ~80KB of schema for a server like Linear.

## Per-server status

`pi-ext/mcp-status.ts` forwards the adapter's `pi-mcp-adapter/status/v1`
snapshots to the renderer under status key `pidex-mcp-status`
(`src/features/connectors/mcpStatus.ts`). That is the only structured source of
per-server state: connected / needs-auth / failed / cached / disabled /
not-connected, plus tool and resource counts. It needs a live session, since
the adapter runs inside one — with no session a connector row reads
“state unknown” rather than inventing one. Signing in does **not** need a
session; only observing state does.

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
readCache / readFile / writeFile`, plus `mcp:authorize /
mcp:submitAuthCallback / mcp:cancelAuth` and the `mcp:authState` broadcast
  (`electron/ipc/mcp-handlers.ts`). The in-session route adds no IPC — it
  drives pi over the existing `piCommand` path and `app:openExternal`.
- Connectors: `shared/connectors.ts` (the adapter's prompt/verdict parsers,
  shared because main and renderer both read them),
  `src/features/connectors/` (`catalog.ts`, `mcpStatus.ts`),
  `src/stores/connectors.ts`, `electron/pi/connector-auth.ts`,
  `src/features/settings/tabs/ConnectorsTab.tsx`, `pi-ext/mcp-status.ts`.
- UI: Settings → MCP (`src/features/settings/tabs/McpTab.tsx`): adapter
  card, resolved server rows (scope badge, enable toggle, cached tool
  disclosure, directTools, shadow notes), add/edit form, chain file list
  with raw editor. Mock cases in `src/dev/mockPidex.ts`.
- E2E: `e2e/smoke.spec.ts` "MCP settings" — seeds `agentDir/mcp.json`,
  asserts the resolved row, toggles disable (file gains `"disabled": true`),
  adds a project server (`.pi/mcp.json` written). "Connectors" — adds Datadog
  on the EU site and asserts the written endpoint, since a per-site host that
  silently defaults to US authorizes and then returns nothing. “Connectors:
  signing in works with no session open” drives the headless flow against the
  stub, which answers `/mcp-auth` with the adapter's real prompt shape.
