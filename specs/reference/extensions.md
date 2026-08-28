# Extensions (pi packages)

pi's capability model is **packages**: npm/git/path bundles that contribute
extensions, skills, prompt templates and themes to every session. pidex's
job is to make that ecosystem manageable without leaving the app — install,
inspect, remove, configure — plus bootstrap pi itself on a fresh machine.

Nothing here invents install semantics: **pi's own package-manager CLI does
every mutation**, pidex only reads state and streams the CLI's output.

## pi package semantics (verified against pi 0.84.2)

| Scope     | Settings file               | npm install dir                       | git clone dir                   |
| --------- | --------------------------- | ------------------------------------- | ------------------------------- |
| `global`  | `~/.pi/agent/settings.json` | `~/.pi/agent/npm/node_modules/<name>` | `~/.pi/agent/git/<host>/<path>` |
| `project` | `<ws>/.pi/settings.json`    | `<ws>/.pi/npm/node_modules/<name>`    | `<ws>/.pi/git/<host>/<path>`    |

- Entries live in the `packages` array as a spec string (`npm:pkg@1.2.3`,
  `git:github.com/u/r@ref`, `/abs/path`, `./rel/path`) **or** the object
  form `{source, extensions?, skills?, …}` for per-resource filtering.
- Local path specs are stored **relative to the settings file's directory**
  (`~/.pi/agent`), so `../../../pkg` resolves to `~/pkg` — not to `~/.pi`.
- pi loads **both** scopes; a project array does not shadow the global one.
- Declaring a package is enough: pi installs missing ones at session start.
  `installed: false` in the UI means "declared, arrives next session".
- Package contents are declared by the `pi` manifest in `package.json`, else
  discovered from convention dirs (`extensions/`, `skills/`, `prompts/`,
  `themes/`). Manifest globs are shown as written; `!exclusions` dropped.
- Exit codes are meaningful: `pi install` on a bad spec exits 1 and leaves
  settings untouched; `pi remove` on an unknown spec is a friendly no-op.
- `pi list` is human-oriented — pidex never parses it, it reads the settings
  files and install dirs directly.

## Rules

- **Mutations shell out to pi** (`pi install [-l]`, `pi remove [-l]`,
  `pi update --extensions`), never hand-edited settings. That buys version
  pinning, git-ref reconciliation, `npmCommand` wrapper support and eager
  installs for free. Project scope adds `-l` and runs with `cwd = workspace`.
- **Reads are file-based** and never spawn anything, so the tab renders
  instantly and works with no pi binary present.
- Renderer sends scope enums and spec strings; every path is resolved in
  `electron/pi/packages.ts`.
- Packages execute arbitrary code in pi's process. The tab says so, the
  catalogue pins reviewed versions, and project-scope packages ride pi's own
  trust prompt.

## Job streaming

Package mutations are long-running with output worth watching, so they use
the pty channel pattern rather than a request/response:

```
packages:run(action, spec, scope, ws?) → { jobId }
  → chunks on  packages:output:<jobId>
  → exit code on packages:exit:<jobId>
```

`usePackageJob` (renderer) owns one job at a time: `start()`, accumulated
`output`, `exitCode`, `running`, and an on-exit callback that refreshes the
list. `JobOutput` renders the stream with a state dot. The same hook powers
the Extensions tab, the MCP adapter card, onboarding, and the Claude
provider test — one mechanism, four surfaces.

`packages:installPi` runs `npm install -g @earendil-works/pi-coding-agent`
through `piProcessEnv()` (login-shell PATH, so fnm/nvm work from a GUI
launch) and reports a clear failure when npm itself is unreachable.

## Surfaces

**Settings → Extensions.** Curated catalogue cards, then installed packages
grouped by scope (name, version, spec, resource counts, `filtered` badge,
remove), then add-by-spec with a scope selector and "Update all". A link to
[pi.dev/packages](https://pi.dev/packages) for the full ecosystem.

**Curated catalogue** (`src/features/settings/catalogue.ts`): a static list
of specs we have read the source of. Entries may declare
`requiresBinary: 'claude'`, which greys the card and explains why when the
binary is missing (`packages:detect`).

**Per-extension tabs.** Curated extensions get real config UIs, registered
in `EXTENSION_TABS` (`SettingsModal.tsx`) and shown **only while their
package is present** — the list re-reads `packages:list` on every modal
open, so installing from the Extensions tab reveals a tab immediately.

They render **nested under the Extensions entry** in the settings sidebar
(indented sub-entries, guide line), not as top-level tabs: they configure an
installed package, so they belong to the package list. The Extensions entry
stays highlighted while a sub-tab is active, and a stale sub-tab (package
removed out-of-band) falls back to the Extensions list instead of rendering
an orphaned panel.

| Tab         | Package                    | Contents                                                                                                                       |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `@saccolabs/pi-claude-cli` | health card (package / `claude` binary / account), tested-version warning, **Test provider** one-click proof, failure playbook |
| Web access  | `pi-web-access`            | seven common search-provider keys (password fields, `$ENV_VAR` support), raw JSON editor                                       |
| MCP         | `pi-mcp-adapter`           | see [11-mcp.md](mcp.md)                                                                                                        |

`pi-subagents` deliberately has **no tab**: it is zero-config by design, so
a catalogue card is the whole story.

**First run.** `PiMissingScreen` offers one-click Install/Update pi with
streamed output and an auto re-check (the copyable command stays as a
fallback). A successful install lands on `GettingStartedScreen`: provider
guidance (subscription `/login` in a terminal, API keys → Agent tab) plus
the same catalogue cards, then Continue.

## Foreign config files

Some packages keep config outside pi's settings. pidex mirrors each
package's own resolution rather than guessing:

- `pi-web-access` → `web-search.json` from `PI_CODING_AGENT_DIR`, then
  `XDG_CONFIG_HOME/pi`, then **`~/.pi`** (not `~/.pi/agent`). Mirrored by
  `webSearchConfigPath()` in `pi-paths.ts`, verified against that package's
  `utils.ts` at 0.24.0.
- Structured writes merge-patch and **refuse to write over a malformed
  file** (same contract as `settings.json`); the tab disables its fields and
  points at the raw editor instead.

## Code map

- Main: `electron/pi/packages.ts` (spec classification, install-dir
  resolution, resource discovery, job runner, `claudeStatus`) — unit tests
  in `electron/pi/packages.test.ts` using fixture dirs via
  `PI_CODING_AGENT_DIR`.
- IPC: `packages:list / run / installPi / detect / claudeStatus /
testClaudeProvider` (`electron/ipc/packages-handlers.ts`);
  `pi:webSearchConfig / patchWebSearchConfig` and the widened
  `pi:readConfigFile|writeConfigFile` union (`pi-config-handlers.ts`).
- Preload: `onPackagesJobOutput` / `onPackagesJobExit`.
- UI: `tabs/ExtensionsTab.tsx` (+ exported `JobOutput`),
  `tabs/ClaudeProviderTab.tsx`, `tabs/WebAccessTab.tsx`, `CatalogueCards.tsx`,
  `catalogue.ts`, `usePackageJob.ts`; `app/PiMissingScreen.tsx`,
  `app/GettingStartedScreen.tsx`. Mock cases in `src/dev/mockPidex.ts`.
- E2E (`e2e/smoke.spec.ts`): four tests — listing with a seeded fixture
  package, install/remove round-trip through the stub's package-manager
  mode, web-access key write, and the Claude provider chain.

## Bundled extensions (pidex's own)

Separate from packages the user installs, pidex ships its own pi extensions
as TypeScript files in `pi-ext/`, loaded into **every** session via
`pi --mode rpc -e <path>` (`bundledExtensions()` in
`electron/ipc/pi-session-handlers.ts`; the e2e stub gets none):

| File                   | Why it must run inside pi                                                      |
| ---------------------- | ------------------------------------------------------------------------------ |
| `artifacts.ts`         | registers the artifact tools (see [07-artifacts.md](../build/07-artifacts.md)) |
| `context-breakdown.ts` | measures context composition — the parts are only visible in-process           |
| `worktree-paths.ts`    | refuses a file read that has escaped a worktree into the main checkout         |
| `tool-name-guard.ts`   | rewrites a malformed tool call before pi persists it and bricks the thread     |
| `mcp-status.ts`        | forwards the MCP adapter's per-server status off pi's shared event bus         |

Plus `orchestrator.ts` and `lane-loop.ts`, loaded only for the sessions that
need them: `orchestrator.ts` for orchestrator sessions, `lane-loop.ts` for
every session that is **not** one. An orchestrator manages lanes and is not a
lane — it runs in the project's main checkout, so a ladder there would grade
whatever branch happens to be out and offer to steer work that is not its own.

Every tool `orchestrator.ts` registers declares at least one **required**
parameter. A tool call carrying no arguments reaches pi as `arguments: ""` on
the Claude Code provider (no `input_json_delta` is streamed, so the bridge's
accumulated JSON is empty), and pi validates before `execute` runs — so an
empty-or-all-optional schema fails every call with `root: must be object` and
the extension never runs. `fleet_status` and `memory_read` both shipped that
way. `pi-ext/orchestrator.test.ts` guards it; see
[specs/log/2026-08-27-orchestrator-empty-tool-arguments.md](../log/2026-08-27-orchestrator-empty-tool-arguments.md).

`worktree-paths.ts` is the only pidex code that can refuse a tool call. A
session in `.pidex/worktrees/<name>` was observed reading files out of the main
checkout — a different branch — because the model rebuilds absolute paths from
what it thinks the project root is, and the worktree's cwd contains the main
checkout as a prefix. `tool_call` is the one hook that sees the path before the
file is opened, which is why this runs in pi rather than in the main process.
The rule is deliberately four-condition narrow (worktree session, path outside
cwd, path inside the main checkout, counterpart exists in cwd) because pi's own
system prompt sends the model to absolute paths outside the cwd for its docs.
Full account: [log/2026-08-22-worktree-path-leak.md](../log/2026-08-22-worktree-path-leak.md).

`context-breakdown.ts` exists because pi reports context usage as one
number. The composed system prompt and the active tool schemas are not
reachable from the renderer at all, so measuring them has to happen inside
pi. Two traps it documents at its call sites, both of which produced wrong
numbers first: `getAllTools()` returns definitions (the schemas that
actually occupy context) while `getActiveTools()` returns **names** — using
the latter for sizing reports a handful of tokens for a tool set costing
thousands; and it publishes at rest (`session_start`, `agent_settled`,
`turn_end`), never mid-stream, because a per-delta recompute walks the whole
branch on every token. It also attributes MCP schema cost **per server**,
which needs the adapter's server names: those arrive on pi's shared event bus
(`pi-mcp-adapter/status/v1`), because the tool-name prefix alone cannot say
which server a tool belongs to under the adapter's default `toolPrefix`.

`mcp-status.ts` exists for the same reason in the other direction: the adapter
knows each server's state (connected / needs-auth / failed / cached /
disabled) and publishes it on that bus, but pi's RPC has no channel for it, so
without this extension a front-end can only read the adapter's one-line prose
footer. It forwards the snapshot verbatim — no rewording, no inference.

### The status channel is a wire contract

Both bundled extensions and provider packages talk to pidex's UI the same
way: `ctx.ui.setStatus(key, text)` → pi's extension-UI request → the
per-session map in `stores/extensionUi.ts`. Three keys are load-bearing today:

| Key                       | Emitter                            | Consumer                                       |
| ------------------------- | ---------------------------------- | ---------------------------------------------- |
| `pidex-context-breakdown` | `pi-ext/context-breakdown.ts`      | `composer/contextBreakdown.ts` → ContextMeter  |
| `pidex-mcp-status`        | `pi-ext/mcp-status.ts`             | `connectors/mcpStatus.ts` → Connectors, footer |
| `claude-rate-limit`       | `@saccolabs/pi-claude-cli` ≥ 0.4.5 | `composer/rateLimit.ts` → ContextMeter         |

The last one crosses a repo boundary, so its shape is API — it is documented
on the emitting side in that repo's `docs/ARCHITECTURE.md`, and changing it
there breaks rendering here with no compile error. Rules for all three: the
payload is JSON in a string, every parser returns `null` rather than
throwing on garbage, and a missing key means "render nothing", never an
empty section. A structured key must also be listed in
`STRUCTURED_STATUS_KEYS` (`features/extension-ui/ExtensionUiHosts.tsx`) or the
status strip renders its JSON as prose. Status pushes must never be able to
break a turn — the emitters swallow their own errors for that reason.

## How provider transcripts render

The Claude Code provider is the first package whose sessions contain block
shapes pi itself never emits, so the transcript layer has provider-specific
handling (`items/transcriptRows.ts`, contract table in
[04-chat.md](chat.md#blocks-from-the-claude-code-provider)):

- **CLI-side tools** — WebSearch, WebFetch, ToolSearch, the user's own MCP
  servers, and Claude Code sub-agents run _inside_ the CLI, so pi never sees
  them as tool calls. The provider reports each as a
  `[Claude Code · Name {args}]` marker text block; pidex parses it into an
  `externalTool` activity step. Left as prose it wrapped raw JSON across
  paragraphs and markdown-linkified any URL inside it.
- **Encrypted thinking** — a signature with no plaintext, which rendered as a
  "thought" that expands to nothing. Skipped on settled items.

Both were quantified by replaying real sessions from all four Claude
families through pidex's own hydration and transcript builder; the fixture in
`chat/__fixtures__/claude-cli-blocks.json` is trimmed from those captures and
guards the behaviour (`items/claudeCliRendering.test.ts`).

- **Sub-agent launches** — `Agent`/`Task` markers render as sub-agent rows
  (badge, description, expandable prompt) and feed the "N agents launched in
  background" strip. What the provider forwards is the **launch and nothing
  else**, so the UI makes no liveness claim: no progress, no result, and the
  CLI does not outlive the turn.

  The tool's default is the destructive one. `Agent` backgrounds the
  sub-agent unless the caller passes `run_in_background: false`, and its own
  tool result promises "you will be notified automatically when it
  completes" — true inside Claude Code's harness, false here. Measured
  2026-08-27: one lane launched five, two more nested inside them, and all
  seven were killed at the same millisecond having run 352 shell calls and
  spent 28.6M cache-read tokens that nothing ever read. A **synchronous**
  sub-agent completes and returns inside a single `claude -p` invocation
  (verified directly), so the `subagentPolicy` directive block asks for that
  form rather than banning the tool. It is prose, so it is a bias and not a
  guarantee; `PI_CLAUDE_CLI_SETTINGS` → `--settings` with
  `permissions.deny: ["Agent","Task"]` is the hard block if one is ever
  needed, and it removes the tool from the model's list entirely.

  Sub-agent **spend** is no longer invisible, though their transcripts still
  are: from provider 0.4.10 the episode's billing comes from
  `result.modelUsage` (every model, sub-agents included) rather than
  `result.usage` (the main agent alone). Before that, a seven-agent turn
  reported \$2.34 of a real \$24.

**If you extend this** (tool request/response UX, live sub-agent trees): the
provider still drops the two things you would need — the `tool_result`
blocks the CLI feeds itself between cycles (so external tools have no result
to show), and everything tagged `parent_tool_use_id` (the nested sub-agent
episode). Both seams are named in that repo's `docs/ARCHITECTURE.md`;
surfacing either needs a provider change first, then a step kind here. Do
not attempt to infer either one from the marker stream — the argument
preview is truncated and read best-effort precisely because nothing may
depend on it parsing.

## Sharp edges

- **The e2e stub is also a package manager.** `e2e/fixtures/pi-stub.cjs`
  dispatches on argv _before_ any RPC/session setup: `install`/`remove` edit
  the sandboxed settings.json and mirror the npm dir layout, `-p` answers
  print mode. An install must never create a stub session.
- **Two gated env hooks**, both `!app.isPackaged` for the same reason as
  `PIDEX_PI_STUB` (an env var must not become code execution in a shipped
  app): the stub override for package jobs, and `PIDEX_CLAUDE_BIN` for the
  Claude health probes. The latter exists because a developer's real
  `claude` shadowed a PATH-prepended fake and made the test machine-dependent.
- **`claude auth status` is local-only** (verified on 2.1.237), so the
  provider tab may probe it on mount; the `Test provider` run is not free —
  it spends a little plan quota, so it stays behind a button.
- Settings edits apply to **new sessions** (pi reads config at spawn). Every
  mutating surface says so.

## The Claude Code provider

`@saccolabs/pi-claude-cli` (our fork of `rchern/pi-claude-cli`) makes Claude
Pro/Max subscription models available inside pi's own agent loop by running
`claude -p` as a model server per turn. pidex treats it as an ordinary
package — the abstraction holds, and `shared/rpc.ts` needed no changes.

Its internals, and the compatibility fixes we shipped, are documented in
that repo's `docs/ARCHITECTURE.md`. Landing log:
[log/2026-08-21-claude-cli-provider-fixes.md](../log/2026-08-21-claude-cli-provider-fixes.md).
