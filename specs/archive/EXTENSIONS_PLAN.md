# Extensions & Claude Code Provider Plan

Status: **delivered** — Phase 0+1 (#29), per-extension tabs (#31), e2e (#32); provider published as `@saccolabs/pi-claude-cli` (0.4.6). Reference: [12-extensions.md](../reference/extensions.md) · [log/2026-08-21-claude-cli-provider-fixes.md](../log/2026-08-21-claude-cli-provider-fixes.md) · [log/2026-08-22-context-and-account-visibility.md](../log/2026-08-22-context-and-account-visibility.md). Since 0.4.3 the provider also stopped emitting empty thinking blocks (0.4.4), began reporting account rate-limit state to the front-end (0.4.5), and fixed a resume delta that replayed the whole transcript on every tool iteration (0.4.6) — mechanics in that repo's `docs/ARCHITECTURE.md`. WS5 (ACP sub-agents) remains deferred by choice.

Approval notes (2026-08-20): fully-featured package management following
pi.dev/packages semantics; fork lives at github.com/agustinsacco/pi-claude-cli
(new repo, careful review before publish); each curated key extension gets a
dedicated, fully-featured settings tab; the Claude-Code-as-subagent (ACP)
route stays deferred until the provider is first-class — then evaluate
pi-subagents × pi-claude-cli interplay (subagent pi processes must also load
the extension and pass the provider/model through; expect extra work).

## Goal

Two connected outcomes:

1. **pidex manages pi packages** — a first-class Settings surface to see, add,
   remove, and configure pi extensions/packages (today only the MCP adapter has
   a one-off install card).
2. **Claude Pro/Max subscription models inside pi's own loop**, via a revived
   `pi-claude-cli` extension, so pidex's model picker offers Claude models that
   bill against the user's plan — fully abstracted behind pi (pidex never
   learns about Claude Code).

Plus a small curated catalogue of known-good extensions, and a first-run
onboarding that installs pi itself and recommends providers/extensions
(Phase 0) — pidex should make all of pi's internals easy to manage.

## Evidence (what exists today)

### pi (v0.84.2, installed docs/source)

- `settings.json` has `packages` (npm/git/path specs) and `extensions` (local
  paths). Project scope: `.pi/settings.json`, gated by pi's trust prompt.
  Declaring a package in settings is enough — pi installs missing packages on
  startup (user scope under `~/.pi/agent/npm/`, project under `.pi/npm/`).
- Object form supports per-package resource filtering
  (`{"source": "npm:x", "extensions": [...]}`); `pi config` is pi's own TUI
  for enable/disable — pidex can write the same settings keys.
- Package manifest: `package.json` `pi` key (`extensions/skills/prompts/
themes` arrays) or convention directories. Gallery listing via the
  `pi-package` npm keyword; official catalogue at <https://pi.dev/packages>
  (5,600+ packages, filterable by type).
- Bundled peer packages for extensions: `@earendil-works/pi-ai`,
  `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox` — declare as
  `peerDependencies` with `"*"`, never bundle.

### pidex (this repo)

- `electron/pi/agent-settings.ts` reads/patches pi settings (global +
  project), with malformed-file protection. IPC: `pi:agentSettings`,
  `pi:patchAgentSettings`, `pi:listResources`, `pi:health`.
- `McpTab.tsx` is the install precedent: appends `npm:pi-mcp-adapter` to the
  `packages` array via `pi:patchAgentSettings` and tells the user to restart
  sessions. No `pi install` subprocess needed.
- `AdvancedTab.tsx` shows discovered resource _names only_ (8 max, no source
  attribution, no management).
- `pi-ext/artifacts.ts` + `rpc-client.ts` (`-e` flags) prove the local
  extension path; `-e` also accepts `npm:`/`git:` specs.

### pi-claude-cli (github.com/rchern/pi-claude-cli, npm 0.3.1)

- ~2k lines. Registers a pi provider whose `streamSimple` spawns
  `claude -p` (stream-json NDJSON): Claude proposes tool calls, a
  **break-early** kill at `message_stop` stops Claude Code from executing
  them itself, pi executes natively, next turn reattaches via `--resume`.
  Custom pi tools (e.g. pidex's `artifact_create`) are advertised to Claude
  through a generated **schema-only MCP server**; tool names/args mapped
  bidirectionally (`Read`→`read`, `Glob`→`find`, …).
- Upstream is stale (last commit 2026-03-21, pinned to pre-rename
  `@mariozechner/pi-*@0.52`). Known state:
  - [stuttlepress/pi-claude-cli](https://github.com/stuttlepress/pi-claude-cli)
    (2026-07-18) ports to `@earendil-works` pi 0.80 and folds unmerged PRs
    #25 (resume/error surfacing — fixes empty responses), #26 (false
    auth warning on Claude Code 2.x), #29 (full thinking-effort range).
    Tested against pi 0.80.10 + Claude Code 2.1.x.
  - Issue #32 diagnoses the remaining 0.84 break precisely: the custom
    `api: "pi-claude-cli"` id must also be registered with
    `registerApiProvider({api, stream, streamSimple})` from
    `@earendil-works/pi-ai/compat`, because pi 0.84's default stream fn
    resolves providers through pi-ai's global api registry (print mode and
    nested loops take that path).
  - Other open issues to inherit knowingly: #19 (ensureMcpConfig timing),
    #12 (silent "Working…" during internal tool exec), #2 (context-limit
    error pass-through → pi's `context_length_exceeded` compaction contract).

## Phase 0 — First-run onboarding (install pi, recommend the ecosystem)

Goal (owner, 2026-08-20): when pidex starts and pi is missing, pidex should
_facilitate_ installing it — not just print a command — and then recommend
providers/extensions so a fresh install lands in a working, useful state.

Today `src/app/PiMissingScreen.tsx` is static text (`npm install -g …`) plus
a "Check again" button.

- **One-click pi install.** New IPC `pi:install` — main process resolves the
  user's node/npm through `shell-env.ts` (fnm/nvm users: GUI-launched
  Electron won't have them without the login-shell env), runs
  `npm install -g @earendil-works/pi-coding-agent`, streams output to the
  screen, re-runs `pi:health` on exit. Fallback when npm isn't resolvable:
  keep the copyable command path.
- **Getting-started step after pi turns healthy** (first run only):
  - Provider recommendations: subscription logins (Codex/ChatGPT,
    Claude Pro/Max, Copilot, xAI, OpenRouter) — pi has no RPC login, so the
    action opens pidex's terminal pane primed with `pi` and per-provider
    `/login <provider>` instructions; API-key providers point at the
    Agent settings.
  - Extension recommendations from the Phase 3 catalogue, detection-driven:
    `claude` binary on PATH → suggest the Claude Code provider card;
    always suggest `pi-mcp-adapter` + `pi-web-access`. One-click installs
    reuse `packages:run`.
  - Re-enterable later from Settings (not a one-shot wizard).

Builds on the same plumbing as Phase 1 (`packages:run`, health, shell-env),
so the two ship together.

## Phase 1 — Settings → Extensions tab

New tab between Agent and MCP. File-based only (no new pi RPC).

**Main process**

- `electron/pi/packages.ts`: resolve the `packages` arrays from both scopes;
  for each entry resolve its install dir (`~/.pi/agent/npm/…`, `.pi/npm/…`,
  git clone dirs, local paths), read `package.json` (`version`, `pi`
  manifest, description) and convention dirs → per-package resource lists.
  Handles the object (filtered) package form.
- New IPC (as implemented — `shared/ipc.ts` + `packages-handlers.ts` + mock
  cases): `packages:list(workspacePath?) → PiPackageEntry[]` and
  `packages:run(action, spec, scope, workspacePath?) → {jobId}` — **shell
  out to pi's own package manager** (`pi install [-l]`, `pi remove`,
  `pi update --extensions`), streaming subprocess output to the UI. This is
  pi's standard practice and buys version pinning, git-ref reconciliation,
  `npmCommand` wrapper support, and eager installs for free. Reading
  (list/enrichment) stays file-based.

**Renderer**

- `ExtensionsTab.tsx`: package list grouped by scope (global / this
  workspace), each row: name, version, source spec, provided resources,
  remove button. Add row: text input accepting `npm:` / `git:` / absolute
  path specs + scope selector. "Restart sessions to apply" note (existing
  pattern). Security note mirroring pi's docs (packages run with full system
  access).
- Curated catalogue section (static data in pidex): card per featured
  package — description, "Add" button, docs link — plus a "Browse all
  packages → pi.dev/packages" link. The `pi-mcp-adapter` card in McpTab
  stays (it's about server config); its install button now runs through
  `packages:run` (done 2026-08-20, settings audit).
- `AdvancedTab` resource viewer gains per-source attribution later (nice to
  have, not required for this phase).

**Verification**: unit tests for `packages.ts` resolution (fixture dirs);
typecheck/lint/test; e2e smoke: open Settings → Extensions with the stub,
add a local-path package, see it listed (uses `PIDEX_TEST_USER_DATA`-style
temp pi dir — confirm `pi-paths.ts` override hooks suffice).

## Phase 2 — Claude Code provider (`pi-claude-cli` revival)

**Adoption path: maintained fork at
[github.com/agustinsacco/pi-claude-cli](https://github.com/agustinsacco/pi-claude-cli)**
(GitHub fork of rchern — keeps attribution + upstream PR path), published
scoped on npm with the `pi-package` keyword. The unscoped name
`pi-claude-cli` is owned by rchern on npm, so the published package must be
renamed (scope = whichever npm identity we own, e.g. `@saccolabs/…`).

**Port status (2026-08-20): done and verified**, branch `port/pi-0.84`
(3 commits on top of stuttlepress's 0.80 port which folded #25/#26/#29):

1. deps → `@earendil-works/pi-*`, peers widened to `"*"` per pi packaging
   guidance; dev deps pinned 0.84.2.
2. rchern#32 fix — `registerApiProvider()` from `pi-ai/compat` alongside
   `pi.registerProvider()`, so print mode / nested-loop paths resolve the
   custom api id.
3. deterministic Claude CLI stub (`tests/e2e/claude-stub.cjs`) speaking the
   stream-json contract, enabling credential-free e2e in CI (and the model
   for pidex's own e2e stub strategy).

Verified: all 307 unit tests pass on 0.84.2 deps; `pi 0.84.2 -e . -p
--model pi-claude-cli/claude-haiku-4-5` streams end-to-end through the stub
(previously the #32 crash path); provider lists the full Anthropic
catalogue; schema-only MCP generated with the session's custom tools.
NOT yet verified (sandbox blocks nested authenticated claude): one real
subscription round-trip + break-early tool execution against Claude Code
2.1.x — run from a normal terminal.

Remaining work items:

1. Careful line-by-line review (owner request) before publish.
2. Re-check open upstream issues: #19 (lazy MCP config timing), #2/(#12)
   (rewrite overflow errors to `context_length_exceeded:` per pi's
   custom-provider contract — unlocks pi auto-compaction; surface progress
   during internal tool exec).
3. Live test matrix against Claude Code 2.1.x: streamed text + thinking;
   built-in tool round-trip (break-early → pi executes → resume); custom
   tool round-trip (pidex `artifact_create` via schema-only MCP); abort
   mid-stream; usage/cost accounting; model switching.
4. Rename + publish to npm (needs `npm login`); PR the #32 fix upstream as
   courtesy; add CI job running unit tests + stub e2e against
   `@earendil-works/pi-coding-agent@latest` to catch pi churn early.

**pidex integration** (small): featured card in the Extensions tab
catalogue — "Claude Pro/Max subscription models" — with preflight status
(claude binary detected? `claude` not being on PATH for GUI-launched
Electron is a real case: detection should reuse `shell-env.ts`). After
install + session restart, Claude models appear in pidex's model picker
automatically through pi's catalogue; zero changes to `shared/rpc.ts`.

**Explicitly out of scope for this phase**: running Claude Code as an
agentic _subagent_ (ACP route) — separate future plan; this phase only makes
Claude models available inside pi's own loop.

## Phase 3 — Curated key extensions

Feature only what we've smoke-tested on current pi. Initial candidates:

| Package                    | Why                                     | Check before listing                           |
| -------------------------- | --------------------------------------- | ---------------------------------------------- |
| `@saccolabs/pi-claude-cli` | Claude subscription models (Phase 2)    | ours                                           |
| `pi-mcp-adapter`           | MCP servers (already integrated)        | already shipped                                |
| `pi-web-access`            | web search/fetch/PDF for pi sessions    | loads on 0.84?                                 |
| `pi-subagents`             | parallel/chained pi subagent delegation | loads on 0.84? tool details render OK in chat? |
| `pi-memory`                | persistent memory across sessions       | loads on 0.84?                                 |

Per entry: pin a reviewed version in the catalogue data (`npm:pkg@x.y.z`),
one-line description, link. Curation rule: read the source before featuring
(pi packages run unsandboxed).

**Each curated extension gets a dedicated, fully-featured settings tab**
(McpTab is the template): a Claude Code tab (CLI detection via shell-env,
version + auth status, default effort, tested-CLI-version hint), and
config/status tabs for each other featured package as their capabilities
warrant. The generic Extensions tab remains the catch-all for everything
non-curated.

Follow-ups (deferred): custom chat renderers for popular extension tools;
per-resource enable/disable UI (pi `config` parity); surfacing
`extension_error` RPC events in the Extensions tab.

## Architecture addendum (Phase 0+1 implementation contract, 2026-08-20)

Verified pi CLI semantics (probed against 0.84.2 in a HOME sandbox):
`pi install <spec>` exits 0/1 and appends to the scope's `packages` array
only on success; npm packages land under `<base>/npm/node_modules/<name>`
(`base` = `~/.pi/agent` global, `<ws>/.pi` project); local paths are stored
_relative to the settings file's directory_; git clones under
`<base>/git/<host>/<path>`; `pi remove` is a friendly no-op for unknown
specs; `pi update --extensions` exits 0. `pi list` output is human-oriented
— pidex reads settings + install dirs directly instead of parsing it.
`piAgentDir()` already honors `PI_CODING_AGENT_DIR`, which is the e2e
sandbox hook.

**Shared types** (`shared/models.ts`): `PiPackageEntry { spec, scope:
'global'|'project', kind: 'npm'|'git'|'path', filtered, name, version?,
description?, installed, installPath?, resources: { extensions, skills,
prompts, themes: string[] } }`.

**IPC** (new module `electron/ipc/packages-handlers.ts`, prefix
`packages:`):

- `packages:list(workspacePath?) → PiPackageEntry[]` — parse both scopes'
  `packages` arrays (string + object forms), resolve install dirs per the
  semantics above, enrich from `package.json` (`pi` manifest) and
  convention directories (plain readdir, no globbing — pidex has no glob
  dep).
- `packages:run(action: 'install'|'remove'|'update', spec, scope,
workspacePath?) → { jobId }` — spawns pi's own CLI with `piProcessEnv()`;
  project scope adds `-l` and runs with `cwd = workspacePath`.
- `packages:installPi() → { jobId }` — `npm install -g
@earendil-works/pi-coding-agent` through the login-shell env (fnm/nvm);
  errors surface in the stream; health re-check is the caller's job.
- `packages:detect() → { claude: boolean }` — `command -v claude` on the
  login-shell PATH, for detection-driven recommendations.

**Job streaming** follows the pty precedent: chunks on
`packages:output:<jobId>`, exit code on `packages:exit:<jobId>`, sent to
the invoking `event.sender`; preload gains `onPackagesJobOutput` /
`onPackagesJobExit` (unsubscribe functions, same shape as `onPtyData`).

**Renderer**:

- `src/features/settings/catalogue.ts` — static curated entries
  (`npm:@saccolabs/pi-claude-cli` [requires claude binary],
  `npm:pi-mcp-adapter`, `npm:pi-web-access`, `npm:pi-subagents`), pinned
  once reviewed.
- `ExtensionsTab.tsx` — scope-grouped package list (name, version, source,
  resources, remove), add-by-spec input, update-all, catalogue cards with
  one-click install, streamed job output panel, restart-sessions +
  security notes. Tab id `extensions` in `settingsUiStore` + modal.
- `PiMissingScreen` — "Install pi" (or "Update pi" on `too-old`) button →
  `packages:installPi`, streamed output, auto re-check; copyable command
  stays as fallback. On a fresh install turning healthy, show the
  getting-started recommendations (providers → Agent tab + `/login`
  guidance; extensions → catalogue installs) before entering the app.
- `mockPidex.ts` — cases for all four channels + no-op job listeners so
  `dev:web` renders the tab.

## Risks & caveats

- **Break-early fragility**: killing the CLI at `message_stop` depends on
  Claude Code's stream-json event ordering; a CC update could shift it.
  Mitigation: pin tested CC versions in the card's status hint; test matrix
  in the fork's CI.
- **pi API churn**: 0.52→0.84 already broke this extension twice
  (rename, api registry). Mitigation: `"*"` peers + a tiny CI job in the
  fork that loads the extension against `@earendil-works/pi-coding-agent@latest`.
- **Auto-install timing**: settings-declared packages install on next pi
  spawn; first session after adding a package pays the npm install cost.
  Surface "installing on next session start" in the UI.
- **Security**: extensions execute arbitrary code in pi's process. The tab
  must say so; catalogue pins reviewed versions; project-scope packages ride
  pi's own trust prompt.
- **ToS posture**: `pi-claude-cli` runs the real authenticated Claude Code
  CLI as the inference engine (plan usage). We deliberately do NOT use
  credential-borrowing approaches (`pi-claude-auth`-style token reuse).

## Decision log

- ~~Install by editing pi `settings.json`~~ **Superseded (2026-08-20,
  owner):** install/remove/update shell out to pi's own package-manager CLI
  — it is pi's standard practice and the only path with full semantics
  (pinning, git refs, `npmCommand`, eager install). Settings-edit survives
  only as a no-binary fallback; McpTab's card migrates to `pi:addPackage`.
- Fork lives at `github.com/agustinsacco/pi-claude-cli` (owner decision);
  npm publish under an owned scope (name TBD — unscoped `pi-claude-cli` is
  taken by upstream), rather than vendoring in `pi-ext/` or depending on
  stuttlepress.
- New Extensions tab rather than growing AdvancedTab — package management is
  a first-class surface, Advanced stays raw-config.
- Claude-Code-as-subagent (ACP) deferred until the provider is first-class;
  then assess pi-subagents interplay (child pi processes need the extension
  loaded + provider/model forwarded).
