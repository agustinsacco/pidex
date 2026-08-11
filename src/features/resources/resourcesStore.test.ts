import { beforeEach, describe, expect, it } from 'vitest'
import type { ResourceSnapshot } from '@shared/models'
import { HISTORY_LIMIT, pushBounded, sessionValue, useResourcesStore } from './resourcesStore'

const usage = (rssKb: number, cpuPercent: number, processCount = 1) => ({
  rssKb,
  cpuPercent,
  processCount,
})

const snapshot = (
  sessions: Array<{ id: string; agentRss: number; termRss: number; cpu: number }>,
): ResourceSnapshot => ({
  at: 1_000,
  perSessionSupported: true,
  sessions: sessions.map((s) => ({
    sessionId: s.id,
    workspacePath: `/repo/${s.id}`,
    agent: usage(s.agentRss, s.cpu),
    terminals: usage(s.termRss, s.cpu * 2, s.termRss > 0 ? 3 : 0),
    total: usage(s.agentRss + s.termRss, s.cpu * 3, s.termRss > 0 ? 4 : 1),
  })),
  app: { rssKb: 360_000, cpuPercent: 9, processes: [] },
})

describe('pushBounded', () => {
  it('appends while under the cap', () => {
    expect(pushBounded([1, 2], 3, 5)).toEqual([1, 2, 3])
  })

  it('drops the oldest samples at the cap so history cannot grow forever', () => {
    // The monitor must not become the leak it exists to find.
    let series: number[] = []
    for (let i = 0; i < HISTORY_LIMIT * 3; i++) series = pushBounded(series, i)
    expect(series).toHaveLength(HISTORY_LIMIT)
    // Keeps the NEWEST samples.
    expect(series.at(-1)).toBe(HISTORY_LIMIT * 3 - 1)
  })

  it('does not mutate the input array', () => {
    const original = [1, 2, 3]
    pushBounded(original, 4, 3)
    expect(original).toEqual([1, 2, 3])
  })
})

describe('sessionValue', () => {
  const snap = snapshot([{ id: 'a', agentRss: 200_000, termRss: 314_000, cpu: 5 }])

  it('reports agent-only usage when terminals are excluded', () => {
    expect(sessionValue(snap, 'a', false).rssKb).toBe(200_000)
  })

  it('includes the terminal process trees when the toggle is on', () => {
    // The point of the toggle: a build/test/dev-server running in this
    // session's shell is charged to the session.
    expect(sessionValue(snap, 'a', true).rssKb).toBe(514_000)
  })

  it('is zero for a session not present in the snapshot', () => {
    expect(sessionValue(snap, 'gone', true)).toEqual({
      rssKb: 0,
      cpuPercent: 0,
      processCount: 0,
    })
  })
})

describe('resources store', () => {
  beforeEach(() => {
    useResourcesStore.setState({
      latest: null,
      historyBySession: {},
      cpuHistory: [],
      includeTerminals: true,
      viewers: 0,
    })
  })

  it('records history per session and totals CPU across them', () => {
    const store = useResourcesStore.getState()
    store.applySnapshot(
      snapshot([
        { id: 'a', agentRss: 200_000, termRss: 100_000, cpu: 2 },
        { id: 'b', agentRss: 150_000, termRss: 0, cpu: 1 },
      ]),
    )

    const state = useResourcesStore.getState()
    expect(state.historyBySession.a).toEqual([300_000])
    expect(state.historyBySession.b).toEqual([150_000])
    // total cpu is per-session `total.cpuPercent` (cpu * 3) summed.
    expect(state.cpuHistory).toEqual([9])
  })

  it('follows the terminals toggle when recording history', () => {
    useResourcesStore.setState({ includeTerminals: false })
    useResourcesStore
      .getState()
      .applySnapshot(snapshot([{ id: 'a', agentRss: 200_000, termRss: 999_000, cpu: 2 }]))
    expect(useResourcesStore.getState().historyBySession.a).toEqual([200_000])
  })

  it('forgets sessions that disappear from the snapshot', () => {
    const store = useResourcesStore.getState()
    store.applySnapshot(
      snapshot([
        { id: 'a', agentRss: 1_000, termRss: 0, cpu: 1 },
        { id: 'b', agentRss: 2_000, termRss: 0, cpu: 1 },
      ]),
    )
    // 'b' is disposed; its history must not be retained.
    store.applySnapshot(snapshot([{ id: 'a', agentRss: 1_100, termRss: 0, cpu: 1 }]))

    const state = useResourcesStore.getState()
    expect(state.historyBySession.a).toEqual([1_000, 1_100])
    expect(state.historyBySession).not.toHaveProperty('b')
  })

  it('bounds per-session history across many ticks', () => {
    const store = useResourcesStore.getState()
    for (let i = 0; i < HISTORY_LIMIT * 2; i++) {
      store.applySnapshot(snapshot([{ id: 'a', agentRss: i, termRss: 0, cpu: 1 }]))
    }
    const state = useResourcesStore.getState()
    expect(state.historyBySession.a).toHaveLength(HISTORY_LIMIT)
    expect(state.cpuHistory).toHaveLength(HISTORY_LIMIT)
  })
})
