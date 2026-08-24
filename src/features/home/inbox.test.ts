import { describe, it, expect } from 'vitest'
import type { FleetSession, OrchestratorDigest } from '@shared/models'
import { buildInbox, waitingLabel } from './inbox'

const NOW = 5_000_000

function session(overrides: Partial<FleetSession>): FleetSession {
  return {
    sessionId: 's1',
    workspacePath: '/repo',
    phase: 'idle',
    filesTouched: [],
    lastActivityAt: NOW,
    turns: 1,
    isOrchestrator: false,
    ...overrides,
  }
}

const digest = (items: OrchestratorDigest['items']): OrchestratorDigest => ({
  workspacePath: '/repo',
  updatedAt: NOW,
  headline: '2 need you',
  items,
})

describe('buildInbox', () => {
  it('surfaces a blocked question with its real options', () => {
    const items = buildInbox({
      sessions: [
        session({
          title: 'session-writer locks',
          phase: 'awaiting-input',
          pendingQuestion: {
            requestId: 'q1',
            method: 'select',
            title: 'Where should the lock live?',
            options: ['session dir', 'app data'],
            askedAt: NOW - 14 * 60_000,
          },
        }),
      ],
      digests: [],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'question',
      requestId: 'q1',
      options: ['session dir', 'app data'],
      waitingMs: 14 * 60_000,
    })
  })

  it('works with no orchestrator and no digest at all', () => {
    const items = buildInbox({
      sessions: [session({ phase: 'error', title: 'broken', lastLine: 'boom' })],
      digests: [],
      now: NOW,
    })
    expect(items).toEqual([
      expect.objectContaining({ kind: 'error', title: 'broken', detail: 'boom' }),
    ])
  })

  it('ranks blocking questions above errors, collisions and advice', () => {
    const items = buildInbox({
      sessions: [
        session({ sessionId: 'a', phase: 'error', title: 'failed' }),
        session({
          sessionId: 'b',
          phase: 'awaiting-input',
          title: 'asking',
          pendingQuestion: {
            requestId: 'q',
            method: 'confirm',
            title: 'Run the tests?',
            askedAt: NOW,
          },
        }),
      ],
      digests: [digest([{ kind: 'attention', text: 'branch is behind main' }])],
      collisions: [{ path: 'shared/rpc.ts', sessionIds: ['a', 'b'] }],
      now: NOW,
    })
    expect(items.map((i) => i.kind)).toEqual(['question', 'error', 'collision', 'digest'])
  })

  it('only promotes attention items from a digest, not suggestions or notes', () => {
    const items = buildInbox({
      sessions: [],
      digests: [
        digest([
          { kind: 'attention', text: 'needs a decision' },
          { kind: 'suggestion', text: 'consider archiving' },
          { kind: 'note', text: 'fyi' },
        ]),
      ],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('needs a decision')
  })

  it('ignores the orchestrator session itself', () => {
    const items = buildInbox({
      sessions: [session({ isOrchestrator: true, phase: 'error', title: 'orc' })],
      digests: [],
      now: NOW,
    })
    expect(items).toEqual([])
  })

  it('puts the longest-waiting question first', () => {
    const ask = (id: string, minutes: number): FleetSession =>
      session({
        sessionId: id,
        phase: 'awaiting-input',
        pendingQuestion: {
          requestId: id,
          method: 'input',
          title: id,
          askedAt: NOW - minutes * 60_000,
        },
      })
    const items = buildInbox({ sessions: [ask('new', 1), ask('old', 40)], digests: [], now: NOW })
    expect(items.map((i) => i.title)).toEqual(['old', 'new'])
  })

  it('does not double-report a session that is both erroring and asking', () => {
    const items = buildInbox({
      sessions: [
        session({
          phase: 'error',
          pendingQuestion: { requestId: 'q', method: 'input', title: 'which one?', askedAt: NOW },
        }),
      ],
      digests: [],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('question')
  })
})

describe('waitingLabel', () => {
  it('stays quiet under a minute', () => {
    expect(waitingLabel(0)).toBeUndefined()
    expect(waitingLabel(59_000)).toBeUndefined()
    expect(waitingLabel(undefined)).toBeUndefined()
  })

  it('reads in minutes then hours', () => {
    expect(waitingLabel(14 * 60_000)).toBe('waiting 14 min')
    expect(waitingLabel(3 * 3_600_000)).toBe('waiting 3 h')
  })
})
