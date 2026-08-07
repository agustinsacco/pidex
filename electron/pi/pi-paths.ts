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
 */

/** pi's agent config directory, overridable for tests and alternate installs. */
export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

/** Root directory holding one subdirectory of session files per workspace. */
export function piSessionsRoot(): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(piAgentDir(), 'sessions')
}

/** `/Users/x/proj` → `--Users-x-proj--` (verified against real dirs). */
export function sessionDirNameForCwd(cwd: string): string {
  const segments = cwd.split(/[/\\]/).filter(Boolean)
  return `--${segments.join('-')}--`
}

/**
 * Session directory for a workspace. pi mangles the REAL path — symlinks
 * resolved, so /var becomes /private/var — so resolve before mangling.
 */
export function sessionDirForCwd(cwd: string): string {
  let resolved = cwd
  try {
    resolved = realpathSync.native(cwd)
  } catch {
    // Path may not exist yet; fall back to the given path.
  }
  return join(piSessionsRoot(), sessionDirNameForCwd(resolved))
}
