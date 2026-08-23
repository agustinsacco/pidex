import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Single source of truth for pi's on-disk layout. Both the agent-settings
 * reader and the session scanner depend on the same env-var contract, so it
 * lives in one place rather than being restated per consumer.
 *
 * Layout (verified against the local install):
 *   ~/.pi/agent/sessions/--<cwd segments joined by dashes>--/<ts>_<uuid>.jsonl
 *
 * The Claude Code CLI's layout lives here too. A session on the
 * `pi-claude-cli` provider is written to disk TWICE — once by pi and once by
 * the CLI it shells out to — and the two harnesses mangle the same cwd
 * differently, so anything that has to find both ledgers needs both rules
 * side by side.
 */

/** pi's agent config directory, overridable for tests and alternate installs. */
export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

/** Root directory holding one subdirectory of session files per workspace. */
export function piSessionsRoot(): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(piAgentDir(), 'sessions')
}

/**
 * pi-web-access's config file. Mirrors that package's own resolution
 * (utils.ts, verified at 0.24.0): PI_CODING_AGENT_DIR, then
 * XDG_CONFIG_HOME/pi, then ~/.pi — note the default is ~/.pi, NOT
 * ~/.pi/agent.
 */
export function webSearchConfigPath(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, 'web-search.json')
  }
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, 'pi', 'web-search.json')
  }
  return join(homedir(), '.pi', 'web-search.json')
}

/** `/Users/x/proj` → `--Users-x-proj--` (verified against real dirs). */
export function sessionDirNameForCwd(cwd: string): string {
  const segments = cwd.split(/[/\\]/).filter(Boolean)
  return `--${segments.join('-')}--`
}

/**
 * Both harnesses mangle the REAL path — symlinks resolved, so /var becomes
 * /private/var. pi resolves it itself; the CLI gets it for free because
 * `process.cwd()` in a spawned child is already resolved. Mangling an
 * unresolved path yields a directory name that simply does not exist.
 */
function realCwd(cwd: string): string {
  try {
    return realpathSync.native(cwd)
  } catch {
    // Path may not exist yet (or any more); fall back to the given path.
    return cwd
  }
}

/** Session directory for a workspace. */
export function sessionDirForCwd(cwd: string): string {
  return join(piSessionsRoot(), sessionDirNameForCwd(realCwd(cwd)))
}

/**
 * The Claude Code CLI's config directory — a separate program's tree, not
 * part of pi's. `CLAUDE_CONFIG_DIR` is the CLI's own documented override and
 * relocates the whole directory, `projects/` included.
 */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

/** Root holding one subdirectory of CLI transcripts per project cwd. */
export function claudeProjectsRoot(): string {
  return join(claudeConfigDir(), 'projects')
}

/** Longest project directory name the CLI writes before it truncates. */
const CLAUDE_PROJECT_DIR_MAX_LENGTH = 200

/**
 * The CLI's own string hash — `h * 31 + c` folded to int32, base36 — used
 * only to disambiguate truncated directory names.
 */
function claudeCwdHash(cwd: string): string {
  let hash = 0
  for (let i = 0; i < cwd.length; i++) {
    hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * `/home/u/proj/.claude/wt` → `-home-u-proj--claude-wt`.
 *
 * EVERY non-alphanumeric becomes a dash — not just the separators. The dots
 * matter in practice: worktrees under `.claude/` are where these sessions
 * actually run, and a separators-only rule misses them by one character.
 * Names longer than 200 characters are truncated and given a hash suffix.
 *
 * Transcribed from the CLI's own implementation (2.1.238) and checked against
 * every directory under a real ~/.claude/projects, truncated ones included.
 * It is the CLI's rule, not ours — if a future version changes it, the worst
 * case here is a lookup that misses, never one that hits the wrong file.
 */
export function claudeProjectDirName(cwd: string): string {
  const mangled = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (mangled.length <= CLAUDE_PROJECT_DIR_MAX_LENGTH) return mangled
  return `${mangled.slice(0, CLAUDE_PROJECT_DIR_MAX_LENGTH)}-${claudeCwdHash(cwd)}`
}

/**
 * The CLI's parallel copy of one session's transcript. pi passes its own
 * session id through to the CLI, so the two ledgers share an id and differ
 * only in where they live.
 *
 * This is a derived path, not a discovered one: the caller must treat a
 * missing file as normal.
 */
export function claudeSessionFileForCwd(cwd: string, sessionId: string): string {
  return join(claudeProjectsRoot(), claudeProjectDirName(realCwd(cwd)), `${sessionId}.jsonl`)
}
