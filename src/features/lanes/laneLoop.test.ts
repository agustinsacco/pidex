import { describe, expect, it } from 'vitest'
import {
  currentRung,
  diffLabel,
  laneAction,
  laneHint,
  laneIsGreen,
  lanePrAction,
  overDiffBudget,
  parseLaneLoop,
} from './laneLoop'
import { DEFAULT_LANE_RUNGS } from '@shared/models'

const payload = (rungs: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ rungs, updatedAt: 1000, ...extra })

describe('parseLaneLoop', () => {
  it('returns null for garbage rather than throwing', () => {
    expect(parseLaneLoop(undefined)).toBeNull()
    expect(parseLaneLoop('')).toBeNull()
    expect(parseLaneLoop('not json')).toBeNull()
    expect(parseLaneLoop('null')).toBeNull()
    expect(parseLaneLoop('{"rungs":"nope"}')).toBeNull()
  })

  it('always returns the full fixed ladder, in order', () => {
    const loop = parseLaneLoop(payload([{ key: 'test', state: 'pass' }]))
    expect(loop?.rungs.map((r) => r.key)).toEqual(DEFAULT_LANE_RUNGS.map((r) => r.key))
  })

  it('defaults an unreported rung to stale, never to pass', () => {
    const loop = parseLaneLoop(payload([{ key: 'tsc', state: 'pass' }]))
    expect(loop?.rungs.find((r) => r.key === 'test')?.state).toBe('stale')
  })

  it('drops unknown rung keys so an extension cannot reorder the ladder', () => {
    const loop = parseLaneLoop(payload([{ key: 'sneaky', state: 'pass' }]))
    expect(loop?.rungs.some((r) => r.key === 'sneaky')).toBe(false)
    expect(loop?.rungs).toHaveLength(DEFAULT_LANE_RUNGS.length)
  })

  it('rejects an unrecognised state rather than trusting it', () => {
    const loop = parseLaneLoop(payload([{ key: 'tsc', state: 'definitely-fine' }]))
    expect(loop?.rungs[0]?.state).toBe('stale')
  })

  it('bounds detail so a whole log cannot land in a fixed-height banner', () => {
    const loop = parseLaneLoop(payload([{ key: 'test', state: 'fail', detail: 'x'.repeat(5000) }]))
    const detail = loop?.rungs.find((r) => r.key === 'test')?.detail ?? ''
    expect(detail.length).toBeLessThanOrEqual(200)
  })

  it('keeps the command and exit code, so a pass is checkable', () => {
    const loop = parseLaneLoop(
      payload([{ key: 'tsc', state: 'pass', command: 'npm run typecheck', exitCode: 0 }]),
    )
    const tsc = loop?.rungs[0]
    expect(tsc?.command).toBe('npm run typecheck')
    expect(tsc?.exitCode).toBe(0)
  })
})

describe('currentRung and laneIsGreen', () => {
  const allPass = DEFAULT_LANE_RUNGS.map((r) => ({ key: r.key, state: 'pass' }))

  it('is green only when every configured rung passes', () => {
    const loop = parseLaneLoop(payload(allPass))!
    expect(laneIsGreen(loop)).toBe(true)
    expect(currentRung(loop)).toBeNull()
  })

  it('skips unconfigured rungs — no lint script is not a lint failure', () => {
    const loop = parseLaneLoop(
      payload(allPass.map((r) => (r.key === 'lint' ? { ...r, state: 'unconfigured' } : r))),
    )!
    expect(laneIsGreen(loop)).toBe(true)
  })

  it('stands on the first rung that is not passing', () => {
    const loop = parseLaneLoop(
      payload([
        { key: 'tsc', state: 'pass' },
        { key: 'test', state: 'fail' },
        { key: 'lint', state: 'pass' },
      ]),
    )!
    expect(currentRung(loop)?.key).toBe('test')
  })
})

describe('laneHint', () => {
  it('names the failure and its first line', () => {
    const loop = parseLaneLoop(
      payload([{ key: 'test', state: 'fail', detail: '2 failing in auth/ttl.test.ts' }]),
    )!
    expect(laneHint(loop)).toBe('test failed — 2 failing in auth/ttl.test.ts.')
  })

  it('counts additional failures without listing them', () => {
    const loop = parseLaneLoop(
      payload([
        { key: 'test', state: 'fail' },
        { key: 'lint', state: 'fail' },
      ]),
    )!
    expect(laneHint(loop)).toContain('and 1 more')
  })

  it('reports what is running', () => {
    const loop = parseLaneLoop(payload([{ key: 'tsc', state: 'running' }]))!
    expect(laneHint(loop)).toBe('Running tsc…')
  })

  it('does not repeat the PR call to action in expanded copy', () => {
    const loop = parseLaneLoop(
      payload(
        DEFAULT_LANE_RUNGS.map((r) => ({ key: r.key, state: r.key === 'pr' ? 'stale' : 'pass' })),
      ),
    )!
    expect(laneHint(loop)).toBe('pr has not run since the last edit.')
  })

  it('says so plainly when the lane is ready', () => {
    const loop = parseLaneLoop(
      payload(DEFAULT_LANE_RUNGS.map((r) => ({ key: r.key, state: 'pass' }))),
    )!
    expect(laneHint(loop)).toContain('can open its PR')
  })

  it('names the stale rung when nothing has failed', () => {
    const loop = parseLaneLoop(
      payload([
        { key: 'tsc', state: 'pass' },
        { key: 'test', state: 'stale' },
      ]),
    )!
    expect(laneHint(loop)).toBe('test has not run since the last edit.')
  })
})

describe('diff reporting', () => {
  it('formats a diff stat', () => {
    const loop = parseLaneLoop(payload([], { diff: { added: 118, removed: 22, files: 4 } }))!
    expect(diffLabel(loop)).toBe('+118 −22 · 4 files')
  })

  it('says nothing when nothing changed', () => {
    const loop = parseLaneLoop(payload([], { diff: { added: 0, removed: 0, files: 0 } }))!
    expect(diffLabel(loop)).toBeUndefined()
  })

  it('flags a change past the size where review stops working', () => {
    const under = parseLaneLoop(payload([], { diff: { added: 300, removed: 50, files: 6 } }))!
    const overLines = parseLaneLoop(payload([], { diff: { added: 800, removed: 50, files: 6 } }))!
    const overFiles = parseLaneLoop(payload([], { diff: { added: 10, removed: 0, files: 40 } }))!
    expect(overDiffBudget(under)).toBe(false)
    expect(overDiffBudget(overLines)).toBe(true)
    expect(overDiffBudget(overFiles)).toBe(true)
  })

  it('honours a per-project budget', () => {
    const loop = parseLaneLoop(
      payload([], {
        diff: { added: 120, removed: 0, files: 2 },
        diffBudget: { lines: 100, files: 5 },
      }),
    )!
    expect(overDiffBudget(loop)).toBe(true)
  })
})

describe('laneAction', () => {
  const ladder = (over: Record<string, string>) =>
    parseLaneLoop(
      payload(
        DEFAULT_LANE_RUNGS.map((r) => ({ key: r.key, state: over[r.key] ?? 'pass' })),
        { diff: { added: 100, removed: 10, files: 3 } },
      ),
    )!

  it('offers nothing when every rung passes', () => {
    expect(laneAction(ladder({}))).toBeNull()
  })

  it('leaves a pending PR to the final ladder-rung CTA', () => {
    const loop = ladder({ pr: 'stale' })
    expect(laneAction(loop)).toBeNull()
    const action = lanePrAction(loop)
    expect(action?.rung).toBe('pr')
    expect(action?.label).toBe('Open a pull request for this lane')
    expect(action?.prompt).toContain('gh pr create')
  })

  it('asks for a split when the diff is over budget, and refuses to ask for more code', () => {
    const action = laneAction(ladder({ diff: 'fail', pr: 'stale' }))
    expect(action?.rung).toBe('diff')
    expect(action?.prompt).toContain('Do not add more code')
    expect(action?.prompt).toContain('smaller pull requests')
  })

  it('prioritises the over-budget diff over any other failure', () => {
    // Splitting first is the point: fixing tests inside an unreviewable diff
    // just makes a bigger unreviewable diff.
    const action = laneAction(ladder({ diff: 'fail', test: 'fail', pr: 'stale' }))
    expect(action?.rung).toBe('diff')
  })

  it('tells the lane to fix the cause, never the check', () => {
    const action = laneAction(ladder({ test: 'fail', pr: 'stale' }))
    expect(action?.rung).toBe('test')
    expect(action?.prompt).toContain('Do not change the check itself')
  })
})
