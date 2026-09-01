import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FleetSession, SessionReaperPrefs } from '@shared/models'
import { sessionEventChannel } from '@shared/ipc'

/** Captures broadcast payloads; BrowserWindow must not exist in unit tests. */
const sent: Array<[string, unknown]> = []
vi.mock('../orchestrator/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => {
    sent.push([channel, payload])
  },
}))
vi.mock('../debug-log', () => ({ log: () => {} }))

import type { ReapDecisionInput } from './session-reaper'

const { pickReapable, SessionReaper } = await import('./session-reaper')

beforeEach(() => {
  sent.length = 0
})

/**
 * The reaper's failure mode is destroyed user work — a killed turn, a killed
 * build — which is strictly worse than the memory it saves. Every test here
 * that says "never" is a safety property, not a preference.
 */

const NOW = 10_000_000
const PREFS: SessionReaperPrefs = { enabled: true, maxLiveSessions: 2, idleGraceMinutes: 15 }
const GRACE_MS = PREFS.idleGraceMinutes * 60_000

function session(id: string, overrides: Partial<FleetSession> = {}): FleetSession {
  return {
    sessionId: id,
    workspacePath: `/work/${id}`,
    diskPath: `/sessions/${id}.jsonl`,
    phase: 'idle',
    filesTouched: [],
    lastActivityAt: NOW - GRACE_MS - 60_000,
    idleSince: NOW - GRACE_MS - 60_000,
    turns: 1,
    isOrchestrator: false,
    ...overrides,
  }
}

function decide(sessions: FleetSession[], overrides: Partial<ReapDecisionInput> = {}) {
  return pickReapable({
    sessions,
    prefs: PREFS,
    activeSessionId: null,
    hasLivePtys: () => false,
    now: NOW,
    ...overrides,
  })
}

describe('pickReapable', () => {
  it('reaps nothing at or under the cap, no matter how idle', () => {
    expect(decide([session('a'), session('b')])).toEqual([])
  })

  it('reaps the least-recently-active first, and only down to the cap', () => {
    const oldest = session('a', { lastActivityAt: NOW - GRACE_MS * 10 })
    const middle = session('b', { lastActivityAt: NOW - GRACE_MS * 5 })
    const newest = session('c', { lastActivityAt: NOW - GRACE_MS * 2 })
    const picked = decide([newest, oldest, middle])
    expect(picked.map((s) => s.sessionId)).toEqual(['a'])
  })

  it('reaps nothing when disabled', () => {
    expect(
      decide([session('a'), session('b'), session('c')], { prefs: { ...PREFS, enabled: false } }),
    ).toEqual([])
  })

  it('never reaps the active session, even as the oldest', () => {
    const oldest = session('a', { lastActivityAt: NOW - GRACE_MS * 10 })
    const picked = decide([oldest, session('b'), session('c')], { activeSessionId: 'a' })
    expect(picked.map((s) => s.sessionId)).toEqual(['b'])
  })

  it('never reaps a session that is streaming, awaiting input, or exited', () => {
    for (const phase of ['streaming', 'awaiting-input', 'error', 'exited'] as const) {
      const busy = session('a', { phase, lastActivityAt: NOW - GRACE_MS * 10 })
      expect(decide([busy, session('b'), session('c')]).map((s) => s.sessionId)).toEqual(['b'])
    }
  })

  it('never reaps a session blocked on a question', () => {
    const asking = session('a', {
      lastActivityAt: NOW - GRACE_MS * 10,
      pendingQuestion: { requestId: 'q1', method: 'confirm', title: 'Deploy?', askedAt: NOW },
    })
    expect(decide([asking, session('b'), session('c')]).map((s) => s.sessionId)).toEqual(['b'])
  })

  it('never reaps the orchestrator', () => {
    const orch = session('a', { isOrchestrator: true, lastActivityAt: NOW - GRACE_MS * 10 })
    expect(decide([orch, session('b'), session('c')]).map((s) => s.sessionId)).toEqual(['b'])
  })

  it('never reaps a session with a live terminal — its shell may be mid-build', () => {
    const withPty = session('a', { lastActivityAt: NOW - GRACE_MS * 10 })
    const picked = decide([withPty, session('b'), session('c')], {
      hasLivePtys: (id) => id === 'a',
    })
    expect(picked.map((s) => s.sessionId)).toEqual(['b'])
  })

  it('never reaps a session whose file path is unknown — it could not be resumed', () => {
    const pathless = session('a', { diskPath: undefined, lastActivityAt: NOW - GRACE_MS * 10 })
    expect(decide([pathless, session('b'), session('c')]).map((s) => s.sessionId)).toEqual(['b'])
  })

  it('waits out the grace period on lastActivityAt AND idleSince', () => {
    // lastActivityAt is the belt on top of the phase suspenders: it moves on
    // every event a session emits, so even a session whose derived phase were
    // wrongly "idle" cannot look idle-past-grace while actually streaming.
    const recentActivity = session('a', { lastActivityAt: NOW - 1_000 })
    const recentIdle = session('b', { idleSince: NOW - 1_000 })
    // 4 live, cap 2 → overflow 2, but only c and d have waited out the grace.
    const picked = decide([recentActivity, recentIdle, session('c'), session('d')])
    expect(picked.map((s) => s.sessionId).sort()).toEqual(['c', 'd'])
  })

  it('reaps several at once when far over the cap', () => {
    const sessions = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      session(id, { lastActivityAt: NOW - GRACE_MS * (10 - i) }),
    )
    const picked = decide(sessions)
    // 5 live, cap 2 → reap 3, oldest first.
    expect(picked.map((s) => s.sessionId)).toEqual(['a', 'b', 'c'])
  })

  it('stops early when fewer sessions are eligible than the overflow', () => {
    const sessions = [
      session('a', { phase: 'streaming' }),
      session('b', { phase: 'streaming' }),
      session('c'),
      session('d', { phase: 'streaming' }),
    ]
    expect(decide(sessions).map((s) => s.sessionId)).toEqual(['c'])
  })
})

/**
 * The sweep's side effects: dispose through the registry, then tell the
 * renderer on the session's own push channel. Order matters — the process is
 * gone before the renderer is told, so acting on the push can never race a
 * dying child.
 */
describe('SessionReaper.sweep', () => {
  it('disposes eligible sessions and pushes `reaped` on their channels', async () => {
    const disposed: string[] = []
    const registryStub = {
      get: (id: string) => (disposed.includes(id) ? undefined : { sessionId: id }),
      dispose: async (id: string) => {
        disposed.push(id)
      },
    }
    const fleetStub = {
      snapshot: () => ({
        sessions: [
          session('a', { lastActivityAt: NOW - GRACE_MS * 10 }),
          session('b'),
          session('c'),
        ],
        updatedAt: NOW,
      }),
    }
    const reaper = new SessionReaper(registryStub as never, fleetStub as never, {
      prefs: () => PREFS,
      hasLivePtys: () => false,
      now: () => NOW,
    })
    await reaper.sweep()

    expect(disposed).toEqual(['a'])
    expect(sent).toEqual([
      [
        sessionEventChannel('a'),
        { kind: 'reaped', diskPath: '/sessions/a.jsonl', workspacePath: '/work/a' },
      ],
    ])
  })

  it('skips a session that died between snapshot and dispose', async () => {
    const registryStub = {
      get: () => undefined,
      dispose: async () => {
        throw new Error('must not be called')
      },
    }
    const fleetStub = {
      snapshot: () => ({
        sessions: [session('a'), session('b'), session('c')],
        updatedAt: NOW,
      }),
    }
    const reaper = new SessionReaper(registryStub as never, fleetStub as never, {
      prefs: () => PREFS,
      hasLivePtys: () => false,
      now: () => NOW,
    })
    await reaper.sweep()
    expect(sent).toEqual([])
  })

  it('never reaps the session the renderer reported active', async () => {
    const disposed: string[] = []
    const registryStub = {
      get: (id: string) => ({ sessionId: id }),
      dispose: async (id: string) => {
        disposed.push(id)
      },
    }
    const fleetStub = {
      snapshot: () => ({
        sessions: [
          session('a', { lastActivityAt: NOW - GRACE_MS * 10 }),
          session('b', { lastActivityAt: NOW - GRACE_MS * 9 }),
          session('c'),
        ],
        updatedAt: NOW,
      }),
    }
    const reaper = new SessionReaper(registryStub as never, fleetStub as never, {
      prefs: () => PREFS,
      hasLivePtys: () => false,
      now: () => NOW,
    })
    reaper.setActiveSession('a')
    await reaper.sweep()
    expect(disposed).toEqual(['b'])
  })
})
