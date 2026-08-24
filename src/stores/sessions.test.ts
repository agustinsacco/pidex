import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldRefreshStatsOn, useSessionsStore } from './sessions'
import { getActiveWorkspace } from './workspaces'

describe('shouldRefreshStatsOn', () => {
  it('refreshes on message_end and tool_execution_end (live climb during a run)', () => {
    // Regression: stats previously only refreshed on agent_end/compaction_end,
    // so the context meter and token count looked frozen for the whole
    // duration of a turn and only jumped once it fully finished.
    expect(shouldRefreshStatsOn('message_end')).toBe(true)
    expect(shouldRefreshStatsOn('tool_execution_end')).toBe(true)
  })

  it('still refreshes on the original triggers', () => {
    expect(shouldRefreshStatsOn('agent_end')).toBe(true)
    expect(shouldRefreshStatsOn('compaction_end')).toBe(true)
  })

  it('does not refresh on high-frequency streaming deltas', () => {
    // These fire many times per second while text streams — refreshing on
    // every one would be excessive even though the RPC itself is cheap.
    expect(shouldRefreshStatsOn('message_update')).toBe(false)
    expect(shouldRefreshStatsOn('tool_execution_update')).toBe(false)
    expect(shouldRefreshStatsOn('agent_start')).toBe(false)
    expect(shouldRefreshStatsOn('message_start')).toBe(false)
    expect(shouldRefreshStatsOn('tool_execution_start')).toBe(false)
  })
})

/**
 * Regression: a main-spawned session must enter `live`.
 *
 * Found by driving the real app, not by any test. The orchestrator is spawned
 * in the main process, so the renderer had no `live` entry for it — and
 * `useActiveWorkspace()` resolves the active session's folder through exactly
 * that map. Activating the orchestrator therefore returned null and dropped
 * the whole app to the workspace picker.
 */
describe('adoptSession', () => {
  const invoke = vi.fn()
  const piCommand = vi.fn()

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined)
    piCommand.mockReset().mockResolvedValue({ success: false })
    vi.stubGlobal('window', {
      pidex: {
        invoke,
        piCommand,
        onSessionPush: () => () => {},
      },
    })
    useSessionsStore.setState({ live: {}, unread: {}, activeSessionId: null })
  })

  it('registers the session so the active workspace resolves', async () => {
    await useSessionsStore.getState().adoptSession('orc-1', '/repo')

    expect(useSessionsStore.getState().live['orc-1']).toMatchObject({
      pidexId: 'orc-1',
      workspacePath: '/repo',
    })
    useSessionsStore.setState({ activeSessionId: 'orc-1' })
    expect(getActiveWorkspace()).toBe('/repo')
  })

  it('is idempotent, so reopening does not re-subscribe', async () => {
    await useSessionsStore.getState().adoptSession('orc-1', '/repo')
    useSessionsStore.setState((s) => ({ unread: { ...s.unread, 'orc-1': 5 } }))
    await useSessionsStore.getState().adoptSession('orc-1', '/repo')
    expect(useSessionsStore.getState().unread['orc-1']).toBe(5)
  })
})
