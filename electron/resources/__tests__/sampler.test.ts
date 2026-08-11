import { describe, expect, it } from 'vitest'
import { buildSnapshot, type SessionProcessInput } from '../sampler'
import type { ProcessRow } from '../process-tree'

const row = (pid: number, ppid: number, rssKb: number, cpu: number, command = 'x'): ProcessRow => ({
  pid,
  ppid,
  rssKb,
  cpuPercent: cpu,
  command,
})

/**
 * A process table shaped like the real thing: one pi agent, and one terminal
 * shell running a build (measured live as zsh → npm → sh → node).
 */
const rows: ProcessRow[] = [
  row(500, 1, 205_824, 0.1, 'pi'), // pi agent for session A
  row(501, 500, 20_000, 0.2, 'rg'), // a tool pi spawned
  row(600, 1, 1_024, 0, '/bin/zsh'), // session A terminal 1
  row(601, 600, 43_008, 0.5, 'npm run typecheck'),
  row(602, 601, 270_336, 106.7, 'node'), // tsc doing the work
  row(700, 1, 199_000, 0.3, 'pi'), // pi agent for session B
  row(900, 1, 50_000, 5, 'unrelated-app'),
]

const metrics = [
  {
    pid: 10,
    type: 'Browser',
    cpu: { percentCPUUsage: 3, idleWakeupsPerSecond: 0 },
    memory: { workingSetSize: 120_000 },
  },
  {
    pid: 11,
    type: 'Tab',
    name: 'Renderer',
    cpu: { percentCPUUsage: 7, idleWakeupsPerSecond: 0 },
    memory: { workingSetSize: 240_000 },
  },
] as unknown as Electron.ProcessMetric[]

const sessionA: SessionProcessInput = {
  sessionId: 'a',
  workspacePath: '/repo/a',
  piPid: 500,
  terminalPids: [600],
}

describe('buildSnapshot', () => {
  it('separates agent cost from terminal cost', () => {
    const snap = buildSnapshot(rows, [sessionA], metrics, 1_000)
    const session = snap.sessions[0]!

    // pi + the tool it spawned.
    expect(session.agent.processCount).toBe(2)
    expect(session.agent.rssKb).toBe(225_824)

    // The whole build tree under the shell — the reason the toggle exists.
    expect(session.terminals.processCount).toBe(3)
    expect(session.terminals.rssKb).toBe(314_368)
    expect(session.terminals.cpuPercent).toBeCloseTo(107.2, 1)
  })

  it('totals agent and terminals together', () => {
    const session = buildSnapshot(rows, [sessionA], metrics, 1_000).sessions[0]!
    expect(session.total.processCount).toBe(5)
    expect(session.total.rssKb).toBe(225_824 + 314_368)
  })

  it('never attributes unrelated host processes to a session', () => {
    const session = buildSnapshot(rows, [sessionA], metrics, 1_000).sessions[0]!
    // pid 900 and session B's agent must not leak into session A.
    expect(session.total.rssKb).toBeLessThan(600_000)
    expect(session.total.processCount).toBe(5)
  })

  it('reports zeroes for a session whose pi process already exited', () => {
    const snap = buildSnapshot(
      rows,
      [{ sessionId: 'dead', workspacePath: '/repo/x', piPid: 4242, terminalPids: [] }],
      metrics,
      1_000,
    )
    const session = snap.sessions[0]!
    expect(session.agent.processCount).toBe(0)
    expect(session.total.rssKb).toBe(0)
  })

  it('handles a session with no terminals', () => {
    const snap = buildSnapshot(
      rows,
      [{ sessionId: 'b', workspacePath: '/repo/b', piPid: 700, terminalPids: [] }],
      metrics,
      1_000,
    )
    const session = snap.sessions[0]!
    expect(session.terminals.processCount).toBe(0)
    expect(session.terminals.rssKb).toBe(0)
    expect(session.total.rssKb).toBe(session.agent.rssKb)
  })

  it('rolls up pidex own Electron processes', () => {
    const snap = buildSnapshot(rows, [sessionA], metrics, 1_000)
    expect(snap.app.rssKb).toBe(360_000)
    expect(snap.app.cpuPercent).toBe(10)
    expect(snap.app.processes).toHaveLength(2)
    expect(snap.app.processes[1]?.name).toBe('Renderer')
  })

  it('stamps the caller-supplied time so ticks are comparable', () => {
    expect(buildSnapshot(rows, [], metrics, 4_242).at).toBe(4_242)
  })

  it('survives an empty process table (Windows / ps failure)', () => {
    const snap = buildSnapshot([], [sessionA], [], 1_000)
    expect(snap.sessions[0]?.total.rssKb).toBe(0)
    expect(snap.app.rssKb).toBe(0)
  })
})
