import { describe, it, expect } from 'vitest'
import type { FleetSession, OrchestratorDigest } from '@shared/models'
import { emptySession } from './fleetReducer'
import {
  badgeCount,
  decideDigestNotification,
  decideNotification,
  questionKey,
} from './notifications'

function asking(id: string, title: string, requestId = 'q1'): FleetSession {
  return {
    ...emptySession(id, '/repo'),
    title,
    phase: 'awaiting-input',
    pendingQuestion: { requestId, method: 'input', title: `${title}?`, askedAt: 0 },
  }
}

const base = { windowFocused: false, muted: false }

describe('decideNotification', () => {
  it('announces a newly blocked session', () => {
    const decision = decideNotification({
      ...base,
      sessions: [asking('a', 'session-writer locks')],
      announced: new Set(),
    })
    expect(decision).toMatchObject({
      title: 'session-writer locks',
      body: 'session-writer locks?',
    })
  })

  /** The coalescing rule: events fire constantly, notifications must not. */
  it('does not re-announce a question it already announced', () => {
    const sessions = [asking('a', 'one')]
    const first = decideNotification({ ...base, sessions, announced: new Set() })
    expect(first).not.toBeNull()
    const second = decideNotification({
      ...base,
      sessions,
      announced: new Set(first!.announced),
    })
    expect(second).toBeNull()
  })

  it('collapses several at once into one message', () => {
    const decision = decideNotification({
      ...base,
      sessions: [asking('a', 'one'), asking('b', 'two')],
      announced: new Set(),
    })
    expect(decision?.title).toBe('2 sessions need you')
    expect(decision?.body).toBe('one, two')
  })

  it('stays silent while the user is looking at the app', () => {
    expect(
      decideNotification({
        ...base,
        windowFocused: true,
        sessions: [asking('a', 'one')],
        announced: new Set(),
      }),
    ).toBeNull()
  })

  it('stays silent when muted', () => {
    expect(
      decideNotification({
        ...base,
        muted: true,
        sessions: [asking('a', 'one')],
        announced: new Set(),
      }),
    ).toBeNull()
  })

  it('ignores the orchestrator itself', () => {
    const orc = { ...asking('orc', 'orchestrator'), isOrchestrator: true }
    expect(decideNotification({ ...base, sessions: [orc], announced: new Set() })).toBeNull()
  })

  it('keys a question by session and request, so a re-ask is new', () => {
    expect(questionKey(asking('a', 'x', 'q1'))).toBe('a:q1')
    expect(questionKey(asking('a', 'x', 'q2'))).toBe('a:q2')
    expect(questionKey(emptySession('a', '/repo'))).toBeNull()
  })
})

describe('decideDigestNotification', () => {
  const digest = (items: OrchestratorDigest['items']): OrchestratorDigest => ({
    workspacePath: '/repo',
    updatedAt: 0,
    headline: '2 need you',
    items,
  })

  it('fires once for a digest carrying attention items', () => {
    const decision = decideDigestNotification(
      digest([
        { kind: 'attention', text: 'branch is behind' },
        { kind: 'attention', text: 'tests failing' },
      ]),
      base,
    )
    expect(decision?.title).toBe('2 need you')
    expect(decision?.body).toContain('2 things need you')
  })

  it('says nothing when the digest is only advice', () => {
    expect(
      decideDigestNotification(digest([{ kind: 'suggestion', text: 'consider archiving' }]), base),
    ).toBeNull()
  })
})

describe('badgeCount', () => {
  it('counts blocked and errored sessions only', () => {
    const sessions: FleetSession[] = [
      asking('a', 'blocked'),
      { ...emptySession('b', '/repo'), phase: 'error' },
      { ...emptySession('c', '/repo'), phase: 'streaming' },
      { ...asking('orc', 'orchestrator'), isOrchestrator: true },
    ]
    expect(badgeCount(sessions)).toBe(2)
  })
})
