/**
 * Which Claude account a live session was spawned onto.
 *
 * A session's account is decided at spawn, but the thing it has to be recorded
 * against — the session's own `.jsonl` path — does not exist yet: pi writes the
 * file when the first turn ends, and the renderer only learns the path from
 * `get_state`. So the pick is parked here under the pidex session id and
 * claimed by `claude:bindSession` once the path is known.
 *
 * Deliberately not persisted. An entry that is never claimed (session
 * disposed before its first turn) dies with the process, and the binding it
 * would have written is one no resume will ever look for.
 */
const bySession = new Map<string, string>()

/** Record the account a spawn chose, keyed by pidex session id. */
export function rememberSpawnAccount(pidexSessionId: string, accountId: string): void {
  bySession.set(pidexSessionId, accountId)
}

/** Claim it. Returns undefined when the session had no account (or was claimed). */
export function takeSpawnAccount(pidexSessionId: string): string | undefined {
  const accountId = bySession.get(pidexSessionId)
  bySession.delete(pidexSessionId)
  return accountId
}

/** Drop a session's parked pick when its subprocess goes away. */
export function forgetSpawnAccount(pidexSessionId: string): void {
  bySession.delete(pidexSessionId)
}
