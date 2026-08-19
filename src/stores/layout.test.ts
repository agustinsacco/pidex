import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { pidex: { invoke: vi.fn().mockResolvedValue(undefined) } })

const { useLayoutStore, sessionPanes } = await import('./layout')
const { useSessionsStore } = await import('./sessions')

const A = 'session-a'
const B = 'session-b'

beforeEach(() => {
  useLayoutStore.setState({ bySession: {}, sidebarVisible: true })
  useSessionsStore.setState({ activeSessionId: A })
})

describe('layout store — right pane is per session', () => {
  it('does not leak an open pane into another session', () => {
    // The bug: rightPane was global, so opening a terminal in one session
    // showed the terminal pane in every session you switched to — and since
    // the pane auto-spawns a shell on first open, merely visiting another
    // session forked a login shell there.
    useLayoutStore.getState().toggleRightPane('terminal')

    expect(sessionPanes(useLayoutStore.getState(), A).pane).toBe('terminal')
    expect(sessionPanes(useLayoutStore.getState(), B).pane).toBeNull()
  })

  it('remembers each session\u2019s own pane across switches', () => {
    useLayoutStore.getState().setRightPane('terminal', A)
    useLayoutStore.getState().setRightPane('files', B)

    expect(sessionPanes(useLayoutStore.getState(), A).pane).toBe('terminal')
    expect(sessionPanes(useLayoutStore.getState(), B).pane).toBe('files')
  })

  it('defaults actions to the active session', () => {
    useSessionsStore.setState({ activeSessionId: B })
    useLayoutStore.getState().toggleRightPane('artifacts')

    expect(sessionPanes(useLayoutStore.getState(), B).pane).toBe('artifacts')
    expect(sessionPanes(useLayoutStore.getState(), A).pane).toBeNull()
  })

  it('toggling the open pane closes it', () => {
    useLayoutStore.getState().toggleRightPane('files')
    useLayoutStore.getState().toggleRightPane('files')
    expect(sessionPanes(useLayoutStore.getState(), A).pane).toBeNull()
  })

  it('switching panes replaces rather than closes', () => {
    useLayoutStore.getState().toggleRightPane('files')
    useLayoutStore.getState().toggleRightPane('terminal')
    expect(sessionPanes(useLayoutStore.getState(), A).pane).toBe('terminal')
  })

  it('scopes expand (\u2197) per session too', () => {
    useLayoutStore.getState().setRightPane('files', A)
    useLayoutStore.getState().toggleRightExpanded(A)

    expect(sessionPanes(useLayoutStore.getState(), A).expanded).toBe(true)
    expect(sessionPanes(useLayoutStore.getState(), B).expanded).toBe(false)
  })

  it('is a no-op with no active session (workspace home has no right pane)', () => {
    useSessionsStore.setState({ activeSessionId: null })
    useLayoutStore.getState().toggleRightPane('terminal')
    expect(useLayoutStore.getState().bySession).toEqual({})
  })

  it('removeSession drops the slice so the map cannot grow forever', () => {
    useLayoutStore.getState().setRightPane('terminal', A)
    useLayoutStore.getState().removeSession(A)
    expect(useLayoutStore.getState().bySession[A]).toBeUndefined()
  })

  it('returns one shared frozen value for unknown sessions', () => {
    const state = useLayoutStore.getState()
    expect(sessionPanes(state, 'nope')).toBe(sessionPanes(state, 'also-nope'))
    expect(sessionPanes(state, null)).toBe(sessionPanes(state, undefined))
    expect(Object.isFrozen(sessionPanes(state, 'nope'))).toBe(true)
  })
})
