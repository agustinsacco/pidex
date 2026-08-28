/**
 * pi session id → Claude Code CLI session id.
 *
 * The two ids used to be one: pi passed its own session id straight through
 * to `claude --session-id`, so a pi session and its CLI transcript shared a
 * name and the path could be derived from the pi id alone. Observer mode
 * (`@saccolabs/pi-claude-cli` ≥ 0.4.x) broke that. The provider now owns ONE
 * long-lived CLI session per pi session, resumed across turns and restarts,
 * and records the pairing in a sidecar map of its own.
 *
 * Everything derived from the old assumption pointed at a file that does not
 * exist: the debug block a user pastes into a bug report, and the second half
 * of a session delete — which is how multi-megabyte CLI transcripts were left
 * behind for every session ever deleted.
 *
 * The sidecar is the provider's, not ours. It is read-only here, every read
 * is best-effort, and a miss falls back to the pi id, which is still correct
 * for sessions recorded before observer mode.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Mirrors `src/session-map.ts` in the provider: the same env override, the
 * same directory, the same file name.
 */
function sessionMapPath(): string {
  const stateDir =
    process.env.PI_CLAUDE_CLI_STATE_DIR ?? join(homedir(), '.pi', 'agent', 'pi-claude-cli')
  return join(stateDir, 'session-map.json')
}

/**
 * The CLI session id paired with a pi session, or null when the map has no
 * entry for it (never ran on the provider, ran before observer mode, or the
 * sidecar is missing).
 */
export async function claudeSessionIdFor(piSessionId: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(sessionMapPath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const mapped = (parsed as Record<string, unknown>)[piSessionId]
    return typeof mapped === 'string' && mapped.length > 0 ? mapped : null
  } catch {
    // Missing, unreadable or corrupt all mean the same thing: no mapping.
    return null
  }
}
