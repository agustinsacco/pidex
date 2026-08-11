import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { ResourceSnapshot, SessionUsage, UsageTotal } from '@shared/models'
import type { ProcessRow } from './process-tree'
import { indexByParent, mergeUsage, parsePsOutput, treeUsage } from './process-tree'

const execFileAsync = promisify(execFile)

/**
 * Host process sampling for the resource monitor.
 *
 * ONE `ps` call per tick covers every process on the machine — measured at
 * ~23ms for 667 processes, versus one spawn per session if we polled pids
 * individually. That single-call design is what makes a 2s tick affordable;
 * do not turn this into a per-session spawn.
 *
 * `ps` is POSIX-only. Windows returns no rows, so per-session numbers are
 * absent there and the UI falls back to Electron's own metrics rather than
 * showing zeroes as if they were real measurements.
 */
export const PS_SUPPORTED = process.platform !== 'win32'

/** Cap output so a pathological process table can't balloon into memory. */
const PS_MAX_BUFFER = 8 * 1024 * 1024

export async function sampleProcesses(): Promise<ProcessRow[]> {
  if (!PS_SUPPORTED) return []
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-Ao', 'pid=,ppid=,rss=,%cpu=,comm='],
      // A hung `ps` must not wedge the monitor; the next tick retries.
      { timeout: 5_000, maxBuffer: PS_MAX_BUFFER },
    )
    return parsePsOutput(stdout)
  } catch {
    // Sampling is best-effort telemetry: never let it throw into a tick.
    return []
  }
}

export interface SessionProcessInput {
  sessionId: string
  workspacePath: string
  /** pi subprocess pid; undefined if it already exited. */
  piPid?: number
  /** Shell pids for this session's terminals. */
  terminalPids: number[]
}

const strip = ({ rssKb, cpuPercent, processCount }: UsageTotal): UsageTotal => ({
  rssKb,
  cpuPercent,
  processCount,
})

/**
 * Build one snapshot from a process table plus the caller's session→pid map.
 *
 * Split from `sampleProcesses` so the arithmetic is testable with synthetic
 * process tables and no live subprocesses.
 */
export function buildSnapshot(
  rows: ProcessRow[],
  inputs: SessionProcessInput[],
  appMetrics: Electron.ProcessMetric[],
  at: number,
): ResourceSnapshot {
  const byParent = indexByParent(rows)

  const sessions: SessionUsage[] = inputs.map((input) => {
    const agentTree = treeUsage(input.piPid, rows, byParent)
    const terminalTrees = input.terminalPids.map((pid) => treeUsage(pid, rows, byParent))
    const terminals = mergeUsage(terminalTrees, rows)
    const total = mergeUsage([agentTree, ...terminalTrees], rows)
    return {
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      agent: strip(agentTree),
      terminals: strip(terminals),
      total: strip(total),
      piPid: input.piPid,
    }
  })

  const appProcesses = appMetrics.map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name ?? metric.serviceName,
    // Electron reports working-set size in kB, matching `ps rss=` units.
    rssKb: metric.memory.workingSetSize,
    cpuPercent: metric.cpu.percentCPUUsage,
  }))

  return {
    at,
    perSessionSupported: PS_SUPPORTED,
    sessions,
    app: {
      rssKb: appProcesses.reduce((total, p) => total + p.rssKb, 0),
      cpuPercent: appProcesses.reduce((total, p) => total + p.cpuPercent, 0),
      processes: appProcesses,
    },
  }
}

/** Sample the host and pidex itself, then fold both into one snapshot. */
export async function sampleSnapshot(
  inputs: SessionProcessInput[],
  now: number,
): Promise<ResourceSnapshot> {
  const rows = await sampleProcesses()
  let metrics: Electron.ProcessMetric[] = []
  try {
    metrics = app.getAppMetrics()
  } catch {
    // Unavailable before `ready`, and in unit tests.
  }
  return buildSnapshot(rows, inputs, metrics, now)
}
