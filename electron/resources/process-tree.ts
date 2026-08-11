/**
 * Pure process-tree maths, kept free of `ps` and Electron so it is unit
 * testable. The sampling I/O lives in `sampler.ts`.
 */

export interface ProcessRow {
  pid: number
  ppid: number
  /** Resident set size in KILOBYTES (what `ps rss=` reports). */
  rssKb: number
  /** Percent of one CPU, as `ps %cpu=` reports it (may exceed 100). */
  cpuPercent: number
  /** Command, truncated by the sampler. */
  command: string
}

export interface TreeUsage {
  /** Every pid in the tree, including the root itself. */
  pids: number[]
  processCount: number
  rssKb: number
  cpuPercent: number
}

/**
 * Parse `ps -Ao pid=,ppid=,rss=,%cpu=,comm=` output.
 *
 * Deliberately tolerant: a malformed line is skipped rather than throwing,
 * because a single unparseable row must not blank out the whole monitor.
 * `comm` can contain spaces, so it is captured greedily as the remainder.
 */
export function parsePsOutput(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line)
    if (!match) continue
    const [, pid, ppid, rss, cpu, command] = match
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKb: Number(rss),
      cpuPercent: Number(cpu),
      command: (command ?? '').trim().slice(0, 120),
    })
  }
  return rows
}

/** Index rows by parent pid so trees can be walked without rescanning. */
export function indexByParent(rows: ProcessRow[]): Map<number, ProcessRow[]> {
  const byParent = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    const siblings = byParent.get(row.ppid)
    if (siblings) siblings.push(row)
    else byParent.set(row.ppid, [row])
  }
  return byParent
}

/**
 * Sum a process and all of its descendants.
 *
 * This is what makes a session's cost honest: `pi` spawns tool subprocesses,
 * and a terminal shell spawns whatever the user ran (a `tsc` build measured
 * 4 processes / 308MB / 107% CPU under one zsh). Charging only the root
 * process would under-report both by an order of magnitude.
 *
 * Cycle-safe via a visited set: pid reuse or a reparented process could
 * otherwise produce an infinite walk.
 */
export function treeUsage(
  rootPid: number | undefined,
  rows: ProcessRow[],
  byParent: Map<number, ProcessRow[]>,
): TreeUsage {
  const empty: TreeUsage = { pids: [], processCount: 0, rssKb: 0, cpuPercent: 0 }
  if (rootPid === undefined) return empty

  const root = rows.find((row) => row.pid === rootPid)
  if (!root) return empty

  const seen = new Set<number>()
  const collected: ProcessRow[] = []
  const stack: ProcessRow[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.pid)) continue
    seen.add(current.pid)
    collected.push(current)
    for (const child of byParent.get(current.pid) ?? []) {
      if (!seen.has(child.pid)) stack.push(child)
    }
  }

  return {
    pids: collected.map((row) => row.pid),
    processCount: collected.length,
    rssKb: collected.reduce((total, row) => total + row.rssKb, 0),
    cpuPercent: collected.reduce((total, row) => total + row.cpuPercent, 0),
  }
}

/**
 * Merge several trees without double-counting a pid.
 *
 * Needed because a session's totals combine its pi tree with one tree per
 * terminal PTY, and those sets can overlap in principle (a shell started from
 * pi). Summing the per-tree numbers would then charge shared pids twice.
 */
export function mergeUsage(trees: TreeUsage[], rows: ProcessRow[]): TreeUsage {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const pids = new Set<number>()
  for (const tree of trees) for (const pid of tree.pids) pids.add(pid)

  let rssKb = 0
  let cpuPercent = 0
  for (const pid of pids) {
    const row = byPid.get(pid)
    if (!row) continue
    rssKb += row.rssKb
    cpuPercent += row.cpuPercent
  }
  return { pids: [...pids], processCount: pids.size, rssKb, cpuPercent }
}
