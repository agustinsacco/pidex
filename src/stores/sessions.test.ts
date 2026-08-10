import { describe, expect, it } from 'vitest'
import { shouldRefreshStatsOn } from './sessions'

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
