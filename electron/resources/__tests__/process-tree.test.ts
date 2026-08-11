import { describe, expect, it } from 'vitest'
import {
  indexByParent,
  mergeUsage,
  parsePsOutput,
  treeUsage,
  type ProcessRow,
} from '../process-tree'

/** Shorthand for building rows in tests. */
const row = (pid: number, ppid: number, rssKb: number, cpu: number, command = 'x'): ProcessRow => ({
  pid,
  ppid,
  rssKb,
  cpuPercent: cpu,
  command,
})

describe('parsePsOutput', () => {
  it('parses real `ps -Ao pid=,ppid=,rss=,%cpu=,comm=` output', () => {
    // Shape copied from actual macOS output, including leading pad on pids.
    const stdout = [
      '  501     1  205824   0.1 /Users/x/.local/bin/node',
      '  502   501    1024   0.0 /bin/zsh',
      ' 1003   502  270336 106.7 node',
    ].join('\n')

    expect(parsePsOutput(stdout)).toEqual([
      row(501, 1, 205824, 0.1, '/Users/x/.local/bin/node'),
      row(502, 501, 1024, 0, '/bin/zsh'),
      row(1003, 502, 270336, 106.7, 'node'),
    ])
  })

  it('keeps commands that contain spaces', () => {
    const parsed = parsePsOutput('  10   1  4096  0.0 npm run typecheck')
    expect(parsed[0]?.command).toBe('npm run typecheck')
  })

  it('skips malformed lines instead of throwing', () => {
    // One bad row must not blank out the whole monitor.
    const parsed = parsePsOutput(['garbage', '', '  7   1  100  0.5 ok', 'PID PPID RSS'].join('\n'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.pid).toBe(7)
  })

  it('truncates pathological command strings', () => {
    const parsed = parsePsOutput(`  9   1  100  0.0 ${'a'.repeat(500)}`)
    expect(parsed[0]?.command).toHaveLength(120)
  })
})

describe('treeUsage', () => {
  const rows = [
    row(100, 1, 1000, 1), // root
    row(101, 100, 2000, 2), // child
    row(102, 101, 4000, 4), // grandchild
    row(200, 1, 8000, 8), // unrelated
  ]
  const byParent = indexByParent(rows)

  it('sums the whole subtree, not just the root', () => {
    // The point of the feature: a build running under a shell must be charged
    // to that shell. Root-only accounting would report 1000/1 here.
    const usage = treeUsage(100, rows, byParent)
    expect(usage.processCount).toBe(3)
    expect(usage.rssKb).toBe(7000)
    expect(usage.cpuPercent).toBe(7)
    expect(usage.pids.sort()).toEqual([100, 101, 102])
  })

  it('excludes unrelated processes', () => {
    expect(treeUsage(100, rows, byParent).pids).not.toContain(200)
  })

  it('returns empty for an unknown or undefined pid', () => {
    expect(treeUsage(9999, rows, byParent).processCount).toBe(0)
    expect(treeUsage(undefined, rows, byParent).processCount).toBe(0)
  })

  it('terminates on a parent/child cycle', () => {
    // Pid reuse can produce a cycle; a naive walk would hang the sampler and
    // with it the main process.
    const cyclic = [row(1, 2, 10, 1), row(2, 1, 20, 2)]
    const usage = treeUsage(1, cyclic, indexByParent(cyclic))
    expect(usage.processCount).toBe(2)
    expect(usage.rssKb).toBe(30)
  })
})

describe('mergeUsage', () => {
  const rows = [row(1, 0, 100, 1), row(2, 1, 200, 2), row(3, 0, 400, 4)]
  const byParent = indexByParent(rows)

  it('counts a pid shared by two trees only once', () => {
    // A session's pi tree and its terminal tree can overlap; summing the two
    // subtotals would double-charge the shared pids.
    const a = treeUsage(1, rows, byParent) // {1,2} => 300
    const b = treeUsage(2, rows, byParent) // {2}   => 200
    const merged = mergeUsage([a, b], rows)
    expect(merged.processCount).toBe(2)
    expect(merged.rssKb).toBe(300)
    expect(merged.cpuPercent).toBe(3)
  })

  it('adds genuinely disjoint trees', () => {
    const merged = mergeUsage([treeUsage(1, rows, byParent), treeUsage(3, rows, byParent)], rows)
    // tree(1) = {1,2} = 300, tree(3) = {3} = 400.
    expect(merged.rssKb).toBe(700)
    expect(merged.processCount).toBe(3)
  })

  it('is empty for no trees', () => {
    expect(mergeUsage([], rows)).toEqual({
      pids: [],
      processCount: 0,
      rssKb: 0,
      cpuPercent: 0,
    })
  })
})
