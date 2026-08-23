import type { FleetSession, OrchestratorDigest } from '@shared/models'

/**
 * What deserves a desktop notification, as a pure function.
 *
 * The rule that matters is **coalescing**: a session emits events constantly,
 * and a notification per event would be unusable. So notifications describe
 * *newly blocked* sessions only — a question that was already pending on the
 * previous snapshot has already been announced — and several at once collapse
 * into a single message.
 */

export interface NotifyDecision {
  title: string
  body: string
  /** Question keys announced, so the caller can remember them. */
  announced: string[]
}

/** Stable identity for "this session is blocked on this question". */
export function questionKey(session: FleetSession): string | null {
  return session.pendingQuestion
    ? `${session.sessionId}:${session.pendingQuestion.requestId}`
    : null
}

export interface NotifyOptions {
  sessions: FleetSession[]
  /** Question keys already announced. */
  announced: ReadonlySet<string>
  /** No notification while the user is looking at the app. */
  windowFocused: boolean
  muted: boolean
}

export function decideNotification({
  sessions,
  announced,
  windowFocused,
  muted,
}: NotifyOptions): NotifyDecision | null {
  if (muted || windowFocused) return null

  const fresh = sessions.filter((session) => {
    if (session.isOrchestrator || !session.pendingQuestion) return false
    const key = questionKey(session)
    return key !== null && !announced.has(key)
  })
  if (fresh.length === 0) return null

  const keys = fresh.map((s) => questionKey(s)!).filter(Boolean)
  if (fresh.length === 1) {
    const session = fresh[0]!
    return {
      title: session.title ?? 'A session needs you',
      body: session.pendingQuestion!.title,
      announced: keys,
    }
  }
  return {
    title: `${fresh.length} sessions need you`,
    body: fresh.map((s) => s.title ?? 'Untitled session').join(', '),
    announced: keys,
  }
}

/** One digest, one notification — never one per item. */
export function decideDigestNotification(
  digest: OrchestratorDigest,
  { windowFocused, muted }: { windowFocused: boolean; muted: boolean },
): { title: string; body: string } | null {
  if (muted || windowFocused) return null
  const attention = digest.items.filter((item) => item.kind === 'attention')
  if (attention.length === 0) return null
  return {
    title: digest.headline,
    body:
      attention.length === 1
        ? attention[0]!.text
        : `${attention.length} things need you — ${attention[0]!.text}`,
  }
}

/**
 * Badge count: things blocking work.
 *
 * Deliberately not "everything the orchestrator mentioned" — a badge that
 * counts advice trains the user to ignore the badge.
 */
export function badgeCount(sessions: FleetSession[]): number {
  return sessions.filter(
    (s) => !s.isOrchestrator && (s.pendingQuestion !== undefined || s.phase === 'error'),
  ).length
}
