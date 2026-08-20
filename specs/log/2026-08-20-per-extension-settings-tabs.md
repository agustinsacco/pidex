# 2026-08-20 — Per-extension settings tabs: Claude Code + Web access (EXTENSIONS_PLAN Phase 3, WS1+WS2)

Curated extensions now get dedicated, fully-featured settings tabs instead
of a catalogue row. Tabs are conditional: `SettingsModal` keeps an
`EXTENSION_TABS` registry matched against `packages:list` on every modal
open, so installing a package from the Extensions tab reveals its tab
immediately, and removing it hides the tab again.

**Claude Code tab** (`ClaudeProviderTab`). A three-row health card —
extension package (installed/version/scope), `claude` binary
(login-shell-PATH resolution, version, path), and Claude account (via
`claude auth status`, verified local-only on Claude Code 2.1.219, so
probing on mount costs nothing) — plus a tested-version warning when the
CLI drifts off the 2.1 line, and a **Test provider** button that runs one
print-mode haiku prompt through `pi` as a streamed job from the OS temp
dir, proving binary + login + extension + plan billing end to end. New
IPC: `packages:claudeStatus`, `packages:testClaudeProvider`.

**Web access tab** (`WebAccessTab`). pi-web-access reads
`web-search.json` from `PI_CODING_AGENT_DIR`, then `XDG_CONFIG_HOME/pi`,
then `~/.pi` — resolution verified against the package's `utils.ts` at
0.24.0 and mirrored by `webSearchConfigPath()` in `pi-paths.ts` (the
default is `~/.pi`, NOT `~/.pi/agent`). The tab exposes the seven common
provider keys (Brave, Tavily, Exa, Jina, Kagi, Serper, OpenAI) as
set/replace/clear rows with password inputs and `$ENV_VAR` support, and a
raw Monaco editor for the long tail (`ConfigFileEditor` generalized to a
third file name). Patches merge-write behind the same
refuse-to-clobber-malformed-JSON guard as settings.json. New IPC:
`pi:webSearchConfig`, `pi:patchWebSearchConfig`.

pi-subagents was researched and deliberately gets **no tab**: it is
zero-config by design (install is the only step), so the catalogue card is
the whole story.

Coverage: unit tests for `parseClaudeAuthStatus` (captured 2.1.219
shapes, logged-out, garbage) and web-search config (path under
`PI_CODING_AGENT_DIR`, merge + undefined-clears-key, malformed refusal);
one e2e (`extensions tab lists pi packages and reveals per-extension
tabs`) seeding the sandboxed agent dir with a fixture package + a declared
Claude provider, asserting the Extensions listing, the
declared-not-installed badge, and the conditional tab flow.
