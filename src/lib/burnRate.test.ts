import { describe, it, expect, beforeEach } from 'vitest'
import {
  assessBurn,
  recordBurnSample,
  burnSamples,
  clearBurnSamples,
  type BurnSample,
} from './burnRate'

const T0 = 1_700_000_000_000

/** Build a two-point window spanning `spanMs` with the given deltas. */
function window(spanMs: number, billed: number, output: number): BurnSample[] {
  return [
    { at: T0, billed: 1000, output: 100 },
    { at: T0 + spanMs, billed: 1000 + billed, output: 100 + output },
  ]
}

describe('assessBurn', () => {
  it('returns null until there are two samples', () => {
    expect(assessBurn([], T0)).toBeNull()
    expect(assessBurn([{ at: T0, billed: 100, output: 10 }], T0)).toBeNull()
  })

  it('returns null when the window is too short to be meaningful', () => {
    // Two samples 3s apart would imply a huge rate from a tiny sample.
    const s = window(3_000, 500_000, 0)
    expect(assessBurn(s, T0 + 3_000)).toBeNull()
  })

  it('ignores samples that have aged out of the window', () => {
    const stale: BurnSample[] = [
      { at: T0 - 600_000, billed: 0, output: 0 },
      { at: T0, billed: 5_000_000, output: 100 },
    ]
    // Only the recent sample survives the filter, so there is nothing to compare.
    expect(assessBurn(stale, T0)).toBeNull()
  })

  it('reports normal for a healthy working session', () => {
    // ~120k tokens/min with a few percent output — the shape of real work.
    const a = assessBurn(window(60_000, 120_000, 5_000), T0 + 60_000)
    expect(a?.level).toBe('normal')
    expect(Math.round(a!.tokensPerMinute)).toBe(120_000)
  })

  it('reports normal at a high rate when the session is still producing', () => {
    // 1.5M/min but 6% output: a big-context session doing genuine work must
    // not be flagged just for being large.
    const a = assessBurn(window(60_000, 1_500_000, 90_000), T0 + 60_000)
    expect(a?.level).toBe('normal')
  })

  it('reports elevated at a moderate rate with almost no output', () => {
    const a = assessBurn(window(60_000, 500_000, 1_000), T0 + 60_000)
    expect(a?.level).toBe('elevated')
  })

  it('reports runaway at the rate the 2026-08-21 incident actually ran', () => {
    // 3.5M tokens in a minute against ~7k output — the observed pathology.
    const a = assessBurn(window(60_000, 3_500_000, 7_000), T0 + 60_000)
    expect(a?.level).toBe('runaway')
    expect(a!.yield).toBeLessThan(0.01)
  })

  it('returns null when counters go backwards (session reset or compaction)', () => {
    const s: BurnSample[] = [
      { at: T0, billed: 900_000, output: 5_000 },
      { at: T0 + 60_000, billed: 40_000, output: 200 },
    ]
    expect(assessBurn(s, T0 + 60_000)).toBeNull()
  })
})

describe('sample history', () => {
  beforeEach(() => clearBurnSamples('s1'))

  it('keeps samples per session and trims to the window', () => {
    recordBurnSample('s1', { at: T0, billed: 10, output: 1 })
    recordBurnSample('s1', { at: T0 + 30_000, billed: 20, output: 2 })
    expect(burnSamples('s1')).toHaveLength(2)

    // A sample well past the window drops everything older than it.
    recordBurnSample('s1', { at: T0 + 500_000, billed: 30, output: 3 })
    expect(burnSamples('s1')).toHaveLength(1)
  })

  it('does not leak between sessions', () => {
    recordBurnSample('s1', { at: T0, billed: 10, output: 1 })
    expect(burnSamples('s2')).toHaveLength(0)
    clearBurnSamples('s2')
    expect(burnSamples('s1')).toHaveLength(1)
  })
})
