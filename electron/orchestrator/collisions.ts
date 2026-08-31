import type { FleetSession } from '@shared/models'

export interface FleetCollision {
  /** Absolute or tool-reported path two live sessions both touched. */
  path: string
  /** Live session ids involved, in snapshot order. */
  sessionIds: string[]
}

/**
 * Sessions working the same file at the same time.
 *
 * Purely mechanical — no model. It exists because this repo has already lost
 * work to it once: two concurrent agent sessions on one tree, one committed
 * and discarded the other's uncommitted changes (see P11's log in
 * docs/specs/TRACKER.md).
 *
 * Only sessions that are still alive count. A finished session that touched a
 * file is history, not a conflict, and warning about it would train the user
 * to ignore the warning.
 */
export function findCollisions(sessions: FleetSession[]): FleetCollision[] {
  const live = sessions.filter(
    (s) => !s.isOrchestrator && s.phase !== 'exited' && s.phase !== 'idle',
  )
  const byPath = new Map<string, string[]>()
  for (const session of live) {
    for (const path of session.filesTouched) {
      const ids = byPath.get(path)
      if (ids) {
        if (!ids.includes(session.sessionId)) ids.push(session.sessionId)
      } else {
        byPath.set(path, [session.sessionId])
      }
    }
  }

  const collisions: FleetCollision[] = []
  for (const [path, sessionIds] of byPath) {
    if (sessionIds.length > 1) collisions.push({ path, sessionIds })
  }
  return collisions
}
