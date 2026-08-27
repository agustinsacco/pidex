import { describe, it, expect, vi } from 'vitest'
import type { FleetSession, OrchestratorMode } from '@shared/models'
import { emptySession } from './fleetReducer'
import { handleFleetCommand, type BridgeDeps } from './bridge'
import { decodeResult, encodeResult, parseRequestTitle, requestTitle } from './protocol'

const ORCHESTRATOR = 'orc-1'
const WORKER = 'work-1'

function session(id: string, overrides: Partial<FleetSession> = {}): FleetSession {
  return { ...emptySession(id, '/repo'), ...overrides }
}

function deps(overrides: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    snapshot: () => [
      session(ORCHESTRATOR, { isOrchestrator: true }),
      session(WORKER, { phase: 'streaming', title: 'auth refactor' }),
    ],
    isOrchestrator: (id) => id === ORCHESTRATOR,
    requestOn: vi.fn(async () => ({ success: true, data: { messages: [] } })),
    answerQuestion: vi.fn(),
    announceInjection: vi.fn(),
    gitStatus: vi.fn(async () => ({ branch: 'main' })),
    readMemory: vi.fn(async () => 'notes'),
    writeMemory: vi.fn(async () => {}),
    publishDigest: vi.fn(),
    proposeWork: vi.fn(async () => ({ started: false })),
    // Supervise is the default posture: may act on sessions, may not start them.
    modeFor: () => 'supervise' as OrchestratorMode,
    ...overrides,
  }
}

const call = (
  d: BridgeDeps,
  caller: string,
  cmd: Parameters<typeof handleFleetCommand>[2],
  args = {},
) => handleFleetCommand(d, caller, cmd, args)

describe('authorization', () => {
  /**
   * The reason the sentinel is safe to carry on a shared UI channel: main
   * refuses it from anything it did not spawn as an orchestrator.
   */
  it('refuses every command from a non-orchestrator session', async () => {
    const d = deps()
    for (const cmd of ['fleet_status', 'session_send', 'session_stop', 'memory_read'] as const) {
      const result = await call(d, WORKER, cmd, { sessionId: ORCHESTRATOR, text: 'x' })
      expect(result).toEqual({ ok: false, error: expect.stringContaining('not authorized') })
    }
    expect(d.requestOn).not.toHaveBeenCalled()
  })

  it('refuses to let an orchestrator drive itself', async () => {
    const result = await call(deps(), ORCHESTRATOR, 'session_send', {
      sessionId: ORCHESTRATOR,
      text: 'go',
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('cannot drive itself') })
  })

  it('refuses to drive another orchestrator', async () => {
    const d = deps({
      snapshot: () => [
        session(ORCHESTRATOR, { isOrchestrator: true }),
        session('orc-2', { isOrchestrator: true }),
      ],
    })
    const result = await call(d, ORCHESTRATOR, 'session_send', { sessionId: 'orc-2', text: 'go' })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('another orchestrator') })
  })
})

describe('fleet_status', () => {
  it('never includes orchestrator sessions, so a sweep cannot observe itself', async () => {
    const result = await call(deps(), ORCHESTRATOR, 'fleet_status')
    expect(result.ok).toBe(true)
    const data = (result as { data: { sessions: FleetSession[] } }).data
    expect(data.sessions.map((s) => s.sessionId)).toEqual([WORKER])
  })
})

describe('session_send', () => {
  it('steers a streaming session and announces it in that transcript', async () => {
    const d = deps()
    const result = await call(d, ORCHESTRATOR, 'session_send', {
      sessionId: WORKER,
      text: 'focus on the failing test',
      mode: 'steer',
    })
    expect(result).toEqual({ ok: true, data: { delivered: 'steer' } })
    expect(d.requestOn).toHaveBeenCalledWith(WORKER, {
      type: 'steer',
      message: 'focus on the failing test',
    })
    expect(d.announceInjection).toHaveBeenCalledWith(WORKER, 'focus on the failing test')
  })

  /** Steering an idle session is meaningless — pi has nothing to interrupt. */
  it('downgrades steer to prompt when the session is idle', async () => {
    const d = deps({
      snapshot: () => [
        session(ORCHESTRATOR, { isOrchestrator: true }),
        session(WORKER, { phase: 'idle' }),
      ],
    })
    await call(d, ORCHESTRATOR, 'session_send', { sessionId: WORKER, text: 'hi', mode: 'steer' })
    expect(d.requestOn).toHaveBeenCalledWith(WORKER, { type: 'prompt', message: 'hi' })
  })

  it('does not announce when the send failed', async () => {
    const d = deps({ requestOn: vi.fn(async () => ({ success: false, error: 'dead' })) })
    const result = await call(d, ORCHESTRATOR, 'session_send', { sessionId: WORKER, text: 'x' })
    expect(result).toEqual({ ok: false, error: 'dead' })
    expect(d.announceInjection).not.toHaveBeenCalled()
  })

  it('rejects an unknown session', async () => {
    const result = await call(deps(), ORCHESTRATOR, 'session_send', {
      sessionId: 'ghost',
      text: 'x',
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('no live session') })
  })
})

describe('session_answer', () => {
  const asking = () =>
    deps({
      snapshot: () => [
        session(ORCHESTRATOR, { isOrchestrator: true }),
        session(WORKER, {
          phase: 'awaiting-input',
          pendingQuestion: {
            requestId: 'q1',
            method: 'select',
            title: 'Where should the lock live?',
            options: ['session dir', 'app data'],
            askedAt: 0,
          },
        }),
      ],
    })

  it('answers a select with one of its own options', async () => {
    const d = asking()
    const result = await call(d, ORCHESTRATOR, 'session_answer', {
      sessionId: WORKER,
      value: 'app data',
    })
    expect(result).toEqual({ ok: true, data: { answered: 'app data' } })
    expect(d.answerQuestion).toHaveBeenCalledWith(WORKER, 'q1', { value: 'app data' })
  })

  it('refuses a value the question never offered', async () => {
    const d = asking()
    const result = await call(d, ORCHESTRATOR, 'session_answer', {
      sessionId: WORKER,
      value: 'somewhere else',
    })
    expect(result.ok).toBe(false)
    expect(d.answerQuestion).not.toHaveBeenCalled()
  })

  it('refuses when nothing is pending', async () => {
    const result = await call(deps(), ORCHESTRATOR, 'session_answer', {
      sessionId: WORKER,
      value: 'x',
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('not waiting') })
  })

  it('refuses a stale requestId', async () => {
    const d = asking()
    const result = await call(d, ORCHESTRATOR, 'session_answer', {
      sessionId: WORKER,
      requestId: 'old',
      value: 'app data',
    })
    expect(result).toEqual({ ok: false, error: expect.stringContaining('no longer pending') })
  })
})

describe('publish_digest', () => {
  it('keeps well-formed items and drops junk ones', async () => {
    const d = deps()
    const result = await call(d, ORCHESTRATOR, 'publish_digest', {
      headline: '2 need you',
      items: [
        { kind: 'attention', text: 'blocked on a question' },
        { kind: 'nonsense', text: 'coerced to note' },
        { text: '' },
        'not an object',
      ],
    })
    expect(result).toEqual({ ok: true, data: { published: 2 } })
    expect(d.publishDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        headline: '2 need you',
        items: [
          { kind: 'attention', text: 'blocked on a question' },
          { kind: 'note', text: 'coerced to note' },
        ],
      }),
    )
  })

  it('requires a headline', async () => {
    const result = await call(deps(), ORCHESTRATOR, 'publish_digest', { items: [] })
    expect(result.ok).toBe(false)
  })
})

describe('memory and proposals', () => {
  it('reads and writes memory against the caller workspace', async () => {
    const d = deps()
    expect(await call(d, ORCHESTRATOR, 'memory_read')).toEqual({
      ok: true,
      data: { content: 'notes' },
    })
    await call(d, ORCHESTRATOR, 'memory_write', { content: 'updated' })
    expect(d.writeMemory).toHaveBeenCalledWith('/repo', 'updated')
  })

  it('proposes work rather than starting it, and reports which happened', async () => {
    const d = deps({
      proposeWork: vi.fn(async () => ({ started: false, reason: 'autopilot off' })),
    })
    const result = await call(d, ORCHESTRATOR, 'propose_work', {
      title: 'flaky e2e',
      prompt: 'fix the flaky terminal test',
    })
    expect(result).toEqual({ ok: true, data: { started: false, reason: 'autopilot off' } })
  })
})

describe('protocol framing', () => {
  it('round-trips a command name through the request title', () => {
    expect(parseRequestTitle(requestTitle('session_send'))).toBe('session_send')
  })

  it('ignores titles that are not ours — an ordinary dialog stays a dialog', () => {
    expect(parseRequestTitle('Where should the lock live?')).toBeNull()
    expect(parseRequestTitle(undefined)).toBeNull()
    expect(parseRequestTitle('pidex-fleet:v1:')).toBeNull()
  })

  it('decodes failures instead of throwing on garbage', () => {
    expect(decodeResult(encodeResult({ ok: true, data: 1 }))).toEqual({ ok: true, data: 1 })
    expect(decodeResult('not json').ok).toBe(false)
    expect(decodeResult('{"nope":1}').ok).toBe(false)
    expect(decodeResult(undefined).ok).toBe(false)
  })
})

describe('actionable suggestions', () => {
  it('turns a startPrompt into a one-click action, and omits it otherwise', async () => {
    const d = deps()
    await call(d, ORCHESTRATOR, 'publish_digest', {
      headline: 'one idea',
      items: [
        {
          kind: 'suggestion',
          text: 'fix the flaky e2e',
          startPrompt: 'fix the flaky terminal test',
        },
        { kind: 'suggestion', text: 'just an observation' },
      ],
    })
    const digest = (d.publishDigest as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as {
      items: { action?: { kind: string; payload?: string } }[]
    }
    expect(digest.items[0]?.action).toEqual({
      label: 'Start this',
      kind: 'start',
      payload: 'fix the flaky terminal test',
    })
    expect(digest.items[1]?.action).toBeUndefined()
  })
})

/**
 * Regression, found by driving the real app: a project's orchestrator reported
 * "No sessions are running right now" while a session was plainly running.
 *
 * pidex gives most chats their own git worktree, so a session's cwd is
 * usually `<repo>/.pidex/worktrees/<name>` and matches no project path
 * exactly. Scoping on cwd alone made the fleet invisible to the very agent
 * whose job is to watch it.
 */
describe('worktree sessions belong to their project', () => {
  it('are visible to fleet_status when scoped by projectRoot', async () => {
    const inWorktree = session('w1', {
      workspacePath: '/repo/.pidex/worktrees/auth-refactor',
      projectRoot: '/repo',
      title: 'auth refactor',
    })
    const d = deps({
      snapshot: () => [session(ORCHESTRATOR, { isOrchestrator: true }), inWorktree],
    })
    const result = await call(d, ORCHESTRATOR, 'fleet_status')
    const sessions = (result as { data: { sessions: FleetSession[] } }).data.sessions
    expect(sessions.map((s) => s.sessionId)).toEqual(['w1'])
  })

  it('can be driven, since the target lookup uses the same scoped snapshot', async () => {
    const d = deps({
      snapshot: () => [
        session(ORCHESTRATOR, { isOrchestrator: true }),
        session('w1', {
          workspacePath: '/repo/.pidex/worktrees/auth-refactor',
          projectRoot: '/repo',
          phase: 'streaming',
        }),
      ],
    })
    const result = await call(d, ORCHESTRATOR, 'session_send', {
      sessionId: 'w1',
      text: 'check the migration',
      mode: 'steer',
    })
    expect(result).toEqual({ ok: true, data: { delivered: 'steer' } })
  })
})

describe('mode enforcement (evaluated per call, not baked into the prompt)', () => {
  const observing = () => deps({ modeFor: () => 'observe' as OrchestratorMode })

  it.each(['session_send', 'session_stop', 'session_answer', 'propose_work'] as const)(
    'refuses %s in Observe mode',
    async (cmd) => {
      const result = await call(observing(), ORCHESTRATOR, cmd, {
        sessionId: WORKER,
        text: 'hi',
        value: 'yes',
        title: 't',
        prompt: 'p',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Observe mode')
        // The refusal must say what to do instead, or the model just retries.
        expect(result.error).toMatch(/Report what you found|switch modes/)
      }
    },
  )

  it('still allows read-only commands in Observe mode', async () => {
    const d = observing()
    expect((await call(d, ORCHESTRATOR, 'fleet_status')).ok).toBe(true)
    expect((await call(d, ORCHESTRATOR, 'session_read', { sessionId: WORKER })).ok).toBe(true)
    expect((await call(d, ORCHESTRATOR, 'git_status')).ok).toBe(true)
    expect((await call(d, ORCHESTRATOR, 'memory_read')).ok).toBe(true)
  })

  it('never touches the session when a mutation is refused', async () => {
    const d = observing()
    await call(d, ORCHESTRATOR, 'session_send', { sessionId: WORKER, text: 'stop' })
    expect(d.requestOn).not.toHaveBeenCalled()
    expect(d.announceInjection).not.toHaveBeenCalled()
  })

  it('allows mutations in Supervise mode', async () => {
    const d = deps()
    const result = await call(d, ORCHESTRATOR, 'session_send', {
      sessionId: WORKER,
      text: 'try the other branch',
    })
    expect(result.ok).toBe(true)
    expect(d.requestOn).toHaveBeenCalled()
  })

  it('reads the mode at call time, so a change applies to the next call', async () => {
    let mode: OrchestratorMode = 'observe'
    const d = deps({ modeFor: () => mode })
    const before = await call(d, ORCHESTRATOR, 'session_send', {
      sessionId: WORKER,
      text: 'hi',
    })
    expect(before.ok).toBe(false)

    mode = 'supervise'
    const after = await call(d, ORCHESTRATOR, 'session_send', {
      sessionId: WORKER,
      text: 'hi',
    })
    expect(after.ok).toBe(true)
  })
})
