import type { FleetSession, OrchestratorDigest } from '@shared/models'

/**
 * What needs the user, derived mechanically from the fleet.
 *
 * Deliberately a pure function over the snapshot: the inbox is the most
 * important thing on the home screen and it must work with no orchestrator
 * running and no model ever having been called. Digest items are folded in as
 * an *extra* source, never a required one.
 */

export type InboxItemKind = 'question' | 'error' | 'collision' | 'digest'

export interface InboxItem {
  id: string
  kind: InboxItemKind
  /** Live session this concerns, when it concerns one. */
  sessionId?: string
  title: string
  detail?: string
  /** Options to answer with, for question items. */
  options?: string[]
  /** Extension-UI request id, for question items. */
  requestId?: string
  /** Confirm questions render yes/no rather than a list. */
  confirm?: boolean
  /** How long it has been waiting, in ms. */
  waitingMs?: number
}

/** Ordering: things that block work first, then failures, then advice. */
const KIND_ORDER: Record<InboxItemKind, number> = {
  question: 0,
  error: 1,
  collision: 2,
  digest: 3,
}

export interface BuildInboxOptions {
  sessions: FleetSession[]
  digests: OrchestratorDigest[]
  collisions?: { path: string; sessionIds: string[] }[]
  now?: number
}

export function buildInbox({
  sessions,
  digests,
  collisions = [],
  now = Date.now(),
}: BuildInboxOptions): InboxItem[] {
  const items: InboxItem[] = []
  const titleOf = (id: string): string =>
    sessions.find((s) => s.sessionId === id)?.title ?? 'Untitled session'

  for (const session of sessions) {
    if (session.isOrchestrator) continue

    if (session.pendingQuestion) {
      const question = session.pendingQuestion
      items.push({
        id: `q:${session.sessionId}:${question.requestId}`,
        kind: 'question',
        sessionId: session.sessionId,
        requestId: question.requestId,
        title: question.title,
        detail: question.message ?? session.title,
        options: question.options,
        confirm: question.method === 'confirm',
        waitingMs: Math.max(0, now - question.askedAt),
      })
    } else if (session.phase === 'error') {
      items.push({
        id: `e:${session.sessionId}`,
        kind: 'error',
        sessionId: session.sessionId,
        title: session.title ?? 'Untitled session',
        detail: session.lastLine ?? 'This session stopped with an error.',
      })
    }
  }

  for (const collision of collisions) {
    items.push({
      id: `c:${collision.path}`,
      kind: 'collision',
      title: `Two sessions are editing ${collision.path}`,
      detail: collision.sessionIds.map(titleOf).join(' · '),
    })
  }

  for (const digest of digests) {
    for (const [index, item] of digest.items.entries()) {
      // Only the orchestrator's "attention" items belong in the inbox;
      // suggestions and notes live under their project's heading, so that
      // asking for advice cannot bury the things that actually block work.
      if (item.kind !== 'attention') continue
      items.push({
        id: `d:${digest.workspacePath}:${index}`,
        kind: 'digest',
        title: item.text,
        detail: digest.headline,
      })
    }
  }

  return items.sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    // Longest-waiting first within a kind.
    return (b.waitingMs ?? 0) - (a.waitingMs ?? 0)
  })
}

/** "waiting 14 min" / "waiting 2 h", or undefined when it is not worth saying. */
export function waitingLabel(ms: number | undefined): string | undefined {
  if (ms === undefined || ms < 60_000) return undefined
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `waiting ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `waiting ${hours} h`
}
