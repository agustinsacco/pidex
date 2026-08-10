import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.stubGlobal('window', {
  pidex: { invoke },
})

// sessions/layout stores pull in window.pidex at import in some paths; the
// stub above must exist before the store module loads.
const { useTerminalStore, sessionTerminals, runningCount } = await import('./terminal')

let nextPty = 1

beforeEach(() => {
  useTerminalStore.setState({ bySession: {}, pendingPaste: null })
  nextPty = 1
  invoke.mockReset()
  invoke.mockImplementation((channel: string) => {
    if (channel === 'pty:create') return Promise.resolve({ ptyId: `pty-${nextPty++}` })
    return Promise.resolve(undefined)
  })
})

describe('terminal store (per-session)', () => {
  it('keys tabs by session id', async () => {
    const store = useTerminalStore.getState()
    await store.createTab('session-a', '/repo')
    await store.createTab('session-b', '/repo')
    const state = useTerminalStore.getState()
    expect(sessionTerminals(state, 'session-a').tabs).toHaveLength(1)
    expect(sessionTerminals(state, 'session-b').tabs).toHaveLength(1)
    expect(sessionTerminals(state, 'session-c')).toBe(sessionTerminals(state, 'session-d'))
  })

  it('markExited finds the owning session by ptyId alone', async () => {
    await useTerminalStore.getState().createTab('session-a', '/repo')
    const ptyId = sessionTerminals(useTerminalStore.getState(), 'session-a').tabs[0]!.ptyId
    useTerminalStore.getState().markExited(ptyId)
    const tab = sessionTerminals(useTerminalStore.getState(), 'session-a').tabs[0]!
    expect(tab.exited).toBe(true)
    expect(tab.running).toBe(false)
  })

  it('applyStatus updates running flags and runningCount', async () => {
    await useTerminalStore.getState().createTab('session-a', '/repo')
    await useTerminalStore.getState().createTab('session-a', '/repo')
    const tabs = sessionTerminals(useTerminalStore.getState(), 'session-a').tabs
    useTerminalStore.getState().applyStatus({ [tabs[0]!.ptyId]: true })
    expect(runningCount(useTerminalStore.getState(), 'session-a')).toBe(1)
    useTerminalStore.getState().applyStatus({ [tabs[0]!.ptyId]: false })
    expect(runningCount(useTerminalStore.getState(), 'session-a')).toBe(0)
  })

  it('removeSession kills every pty and drops the slice', async () => {
    await useTerminalStore.getState().createTab('session-a', '/repo')
    await useTerminalStore.getState().createTab('session-a', '/repo')
    invoke.mockClear()
    await useTerminalStore.getState().removeSession('session-a')
    expect(invoke.mock.calls.filter(([c]) => c === 'pty:kill')).toHaveLength(2)
    expect(useTerminalStore.getState().bySession['session-a']).toBeUndefined()
  })

  it('closeTab moves activeId to the remaining tab', async () => {
    const store = useTerminalStore.getState()
    await store.createTab('session-a', '/repo')
    await store.createTab('session-a', '/repo')
    const [first, second] = sessionTerminals(useTerminalStore.getState(), 'session-a').tabs
    await useTerminalStore.getState().closeTab('session-a', second!.ptyId)
    expect(sessionTerminals(useTerminalStore.getState(), 'session-a').activeId).toBe(first!.ptyId)
  })
})
