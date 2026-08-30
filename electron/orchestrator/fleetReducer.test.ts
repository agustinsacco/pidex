import { describe, it, expect } from 'vitest'
import { FILES_TOUCHED_CAP, type FleetSession } from '@shared/models'
import type { AssistantMessage, ExtensionUIRequest, PiEvent } from '@shared/rpc'
import { emptySession, fleetReducer, lastProseLine, pathFromArgs } from './fleetReducer'
import { findCollisions } from './collisions'

const T0 = 1_000_000

function session(overrides: Partial<FleetSession> = {}): FleetSession {
  return { ...emptySession('s1', '/repo', { now: T0 }), ...overrides }
}

function assistant(text: string, stopReason?: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...(stopReason ? { stopReason } : {}),
  }
}

const event = (event: PiEvent) => ({ kind: 'event' as const, event })

describe('fleetReducer phases', () => {
  it('agent_start begins streaming and counts a turn', () => {
    const next = fleetReducer(session(), event({ type: 'agent_start' }), T0 + 1)
    expect(next.phase).toBe('streaming')
    expect(next.turns).toBe(1)
    expect(next.idleSince).toBeUndefined()
  })

  it('agent_settled goes idle and stamps idleSince', () => {
    const streaming = fleetReducer(session(), event({ type: 'agent_start' }), T0 + 1)
    const next = fleetReducer(streaming, event({ type: 'agent_settled' }), T0 + 500)
    expect(next.phase).toBe('idle')
    expect(next.idleSince).toBe(T0 + 500)
  })

  it('exit is terminal and clears the running tool', () => {
    const busy = session({ phase: 'streaming', currentTool: 'bash' })
    const next = fleetReducer(busy, { kind: 'exit' }, T0 + 1)
    expect(next.phase).toBe('exited')
    expect(next.currentTool).toBeUndefined()
  })

  it('an errored assistant turn marks the session errored', () => {
    const next = fleetReducer(
      session({ phase: 'streaming' }),
      event({ type: 'message_end', message: assistant('boom', 'error') }),
      T0 + 1,
    )
    expect(next.phase).toBe('error')
  })

  it('agent_settled does not overwrite an error with idle', () => {
    const errored = session({ phase: 'error' })
    const next = fleetReducer(errored, event({ type: 'agent_settled' }), T0 + 1)
    expect(next.phase).toBe('error')
  })
})

describe('fleetReducer questions', () => {
  const ask: ExtensionUIRequest = {
    type: 'extension_ui_request',
    id: 'req-1',
    method: 'select',
    title: 'Where should the lock live?',
    options: ['session dir', 'app data'],
  }

  it('a select request blocks the session as awaiting-input', () => {
    const next = fleetReducer(
      session({ phase: 'streaming' }),
      { kind: 'extension-ui', request: ask },
      T0,
    )
    expect(next.phase).toBe('awaiting-input')
    expect(next.pendingQuestion).toMatchObject({
      requestId: 'req-1',
      options: ['session dir', 'app data'],
    })
  })

  /**
   * The regression that motivated the guard: pi settles while a dialog is
   * open, so folding agent_settled naively would drop the session out of the
   * "needs you" inbox at the exact moment it needs you.
   */
  it('a pending question survives agent_settled', () => {
    const asked = fleetReducer(session(), { kind: 'extension-ui', request: ask }, T0)
    const next = fleetReducer(asked, event({ type: 'agent_settled' }), T0 + 10)
    expect(next.phase).toBe('awaiting-input')
    expect(next.pendingQuestion?.requestId).toBe('req-1')
  })

  it('answering clears the question and resumes streaming', () => {
    const asked = fleetReducer(session(), { kind: 'extension-ui', request: ask }, T0)
    const next = fleetReducer(asked, { kind: 'question-answered', requestId: 'req-1' }, T0 + 20)
    expect(next.pendingQuestion).toBeUndefined()
    expect(next.phase).toBe('streaming')
  })

  it('answering a stale request id changes nothing', () => {
    const asked = fleetReducer(session(), { kind: 'extension-ui', request: ask }, T0)
    const next = fleetReducer(asked, { kind: 'question-answered', requestId: 'other' }, T0 + 20)
    expect(next).toBe(asked)
  })

  it('notify is not a question', () => {
    const notify: ExtensionUIRequest = {
      type: 'extension_ui_request',
      id: 'n1',
      method: 'notify',
      message: 'heads up',
    }
    const next = fleetReducer(session(), { kind: 'extension-ui', request: notify }, T0)
    expect(next.pendingQuestion).toBeUndefined()
    expect(next.phase).toBe('idle')
  })
})

describe('filesTouched', () => {
  it('harvests known path arguments and de-duplicates', () => {
    let state = session()
    for (const path of ['src/a.ts', 'src/a.ts', 'src/b.ts']) {
      state = fleetReducer(
        state,
        event({ type: 'tool_execution_start', toolCallId: 't', toolName: 'edit', args: { path } }),
        T0,
      )
    }
    expect(state.filesTouched).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('ignores tools with no path-shaped argument', () => {
    const next = fleetReducer(
      session(),
      event({
        type: 'tool_execution_start',
        toolCallId: 't',
        toolName: 'bash',
        args: { command: 'rm -rf /tmp/x' },
      }),
      T0,
    )
    expect(next.filesTouched).toEqual([])
  })

  it('is bounded so a long session cannot grow the broadcast forever', () => {
    let state = session()
    for (let i = 0; i < FILES_TOUCHED_CAP + 25; i++) {
      state = fleetReducer(
        state,
        event({
          type: 'tool_execution_start',
          toolCallId: `t${i}`,
          toolName: 'read',
          args: { file_path: `src/file-${i}.ts` },
        }),
        T0,
      )
    }
    expect(state.filesTouched).toHaveLength(FILES_TOUCHED_CAP)
    // Keeps the most recent, drops the oldest.
    expect(state.filesTouched.at(-1)).toBe(`src/file-${FILES_TOUCHED_CAP + 24}.ts`)
    expect(state.filesTouched).not.toContain('src/file-0.ts')
  })

  it('pathFromArgs reads each supported key', () => {
    expect(pathFromArgs({ path: 'a' })).toBe('a')
    expect(pathFromArgs({ file_path: 'b' })).toBe('b')
    expect(pathFromArgs({ filePath: 'c' })).toBe('c')
    expect(pathFromArgs({ nothing: 'd' })).toBeUndefined()
    expect(pathFromArgs({ path: '  ' })).toBeUndefined()
    expect(pathFromArgs(undefined)).toBeUndefined()
  })
})

describe('lastProseLine', () => {
  it('takes the last non-empty line', () => {
    expect(lastProseLine(assistant('first\n\nsecond\n\n'))).toBe('second')
  })

  it('truncates long lines', () => {
    const line = lastProseLine(assistant('x'.repeat(400)))
    expect(line).toHaveLength(160)
    expect(line?.endsWith('…')).toBe(true)
  })

  it('ignores non-assistant messages and tool-only turns', () => {
    expect(lastProseLine({ role: 'user', content: 'hi' })).toBeUndefined()
    expect(
      lastProseLine({
        role: 'assistant',
        content: [{ type: 'toolCall', id: '1', name: 'read', arguments: {} }],
      }),
    ).toBeUndefined()
  })
})

describe('perf: streaming deltas do not churn state', () => {
  it('returns the identical object for message_update', () => {
    const state = session({ phase: 'streaming' })
    const next = fleetReducer(
      state,
      event({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'p' },
      }),
      T0,
    )
    expect(next).toBe(state)
  })
})

describe('findCollisions', () => {
  it('flags a file two live sessions are both touching', () => {
    const collisions = findCollisions([
      session({ sessionId: 'a', phase: 'streaming', filesTouched: ['shared/rpc.ts', 'a.ts'] }),
      session({ sessionId: 'b', phase: 'streaming', filesTouched: ['shared/rpc.ts'] }),
    ])
    expect(collisions).toEqual([{ path: 'shared/rpc.ts', sessionIds: ['a', 'b'] }])
  })

  it('ignores finished and idle sessions', () => {
    const collisions = findCollisions([
      session({ sessionId: 'a', phase: 'streaming', filesTouched: ['x.ts'] }),
      session({ sessionId: 'b', phase: 'exited', filesTouched: ['x.ts'] }),
      session({ sessionId: 'c', phase: 'idle', filesTouched: ['x.ts'] }),
    ])
    expect(collisions).toEqual([])
  })

  it('ignores the orchestrator, which reads everything by design', () => {
    const collisions = findCollisions([
      session({
        sessionId: 'orc',
        phase: 'streaming',
        isOrchestrator: true,
        filesTouched: ['x.ts'],
      }),
      session({ sessionId: 'a', phase: 'streaming', filesTouched: ['x.ts'] }),
    ])
    expect(collisions).toEqual([])
  })
})
