import { describe, expect, it } from 'vitest'
import { parseMcpStatus, stateLabel } from './mcpStatus'

/** Shaped like the adapter's own `createMcpStatusSnapshot` output. */
const snapshot = JSON.stringify({
  version: 1,
  servers: [
    { name: 'linear', status: 'connected', toolCount: 24, resourceCount: 2, disabled: false },
    { name: 'slack', status: 'needs-auth', toolCount: 0, disabled: false },
    { name: 'datadog', status: 'failed', toolCount: 0, failedAgoSeconds: 12, disabled: false },
    { name: 'notion', status: 'disabled', toolCount: 0, disabled: true },
  ],
  totalTools: 24,
  totalResources: 2,
  connectedCount: 1,
  disabledCount: 1,
})

describe('parseMcpStatus', () => {
  it('reads per-server state, tools and counts', () => {
    const parsed = parseMcpStatus(snapshot)!
    expect(parsed.servers.map((s) => [s.name, s.state])).toEqual([
      ['linear', 'connected'],
      ['slack', 'needs-auth'],
      ['datadog', 'failed'],
      ['notion', 'disabled'],
    ])
    expect(parsed.servers[0]).toMatchObject({ toolCount: 24, resourceCount: 2 })
    expect(parsed.servers[2]?.failedAgoSeconds).toBe(12)
    expect(parsed.totalTools).toBe(24)
    // Recomputed from the rows rather than trusted, so a stale count in the
    // payload cannot disagree with the badges beside it.
    expect(parsed.connectedCount).toBe(1)
    expect(parsed.disabledCount).toBe(1)
  })

  it('degrades to no status rather than a wrong badge', () => {
    expect(parseMcpStatus(undefined)).toBeNull()
    expect(parseMcpStatus('not json')).toBeNull()
    expect(parseMcpStatus('{"servers":"nope"}')).toBeNull()
    expect(parseMcpStatus('[]')).toBeNull()
  })

  it('drops unusable rows and unknown states', () => {
    const parsed = parseMcpStatus(
      JSON.stringify({
        servers: [{ status: 'connected' }, { name: 'x', status: 'quantum', toolCount: -4 }, 'nope'],
      }),
    )!
    expect(parsed.servers).toEqual([{ name: 'x', state: 'not-connected', toolCount: 0 }])
  })

  it('labels every state it can report', () => {
    expect(stateLabel('needs-auth')).toBe('Needs sign-in')
    expect(stateLabel('cached')).toBe('Idle (cached tools)')
  })
})
