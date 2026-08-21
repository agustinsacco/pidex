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

| Tab         | Package                    | Contents                                                                                                                       |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | `@saccolabs/pi-claude-cli` | health card (package / `claude` binary / account), tested-version warning, **Test provider** one-click proof, failure playbook |
| Web access  | `pi-web-access`            | seven common search-provider keys (password fields, `$ENV_VAR` support), raw JSON editor                                       |
| MCP         | `pi-mcp-adapter`           | see [11-mcp.md](11-mcp.md)                                                                                                     |

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
  in `electron/pi/__tests__/packages.test.ts` using fixture dirs via
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
[log/2026-08-21-claude-cli-provider-fixes.md](log/2026-08-21-claude-cli-provider-fixes.md).
