import { describe, expect, it } from 'vitest'
import { breakdownSlices, parseContextBreakdown } from './contextBreakdown'

/** Shape captured live from the bundled extension via pi's status channel. */
const LIVE = JSON.stringify({
  totalTokens: null,
  contextWindow: null,
  parts: { messages: 0, systemPrompt: 728, tools: 638, mcpTools: 0 },
  counts: { tools: 4, mcpTools: 0, messages: 0 },
  approximate: true,
})

describe('parseContextBreakdown', () => {
  it('parses the live payload', () => {
    const parsed = parseContextBreakdown(LIVE)
    expect(parsed?.parts).toEqual({ messages: 0, systemPrompt: 728, tools: 638, mcpTools: 0 })
    expect(parsed?.counts.tools).toBe(4)
    expect(parsed?.approximate).toBe(true)
  })

  it('degrades to null rather than throwing on untrusted input', () => {
    // A status string comes from a subprocess; a bad one must not break the meter.
    expect(parseContextBreakdown(undefined)).toBeNull()
    expect(parseContextBreakdown('not json')).toBeNull()
    expect(parseContextBreakdown('{}')).toBeNull()
    expect(parseContextBreakdown('{"parts":"nope"}')).toBeNull()
  })

  it('clamps nonsense numbers instead of trusting them', () => {
    const parsed = parseContextBreakdown(
      '{"parts":{"messages":-5,"systemPrompt":"x","tools":10,"mcpTools":null}}',
    )
    expect(parsed?.parts).toEqual({ messages: 0, systemPrompt: 0, tools: 10, mcpTools: 0 })
  })
})

describe('breakdownSlices', () => {
  const breakdown = parseContextBreakdown(
    JSON.stringify({
      parts: { messages: 300, systemPrompt: 100, tools: 100, mcpTools: 0 },
      counts: { tools: 4, mcpTools: 0, messages: 12 },
      approximate: true,
    }),
  )!

  it("scales estimates onto pi's authoritative total", () => {
    // Estimates sum to 500; pi says 1000. Components double, and the split
    // stays 60/20/20 — proportions are the point, the total is pi's.
    const slices = breakdownSlices(breakdown, 1000, 10_000)
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s.tokens]))
    expect(byKey.messages).toBe(600)
    expect(byKey.systemPrompt).toBe(200)
    expect(byKey.tools).toBe(200)
  })

  it('always ends with free space as the honest remainder', () => {
    const slices = breakdownSlices(breakdown, 1000, 10_000)
    const free = slices[slices.length - 1]!
    expect(free.key).toBe('free')
    expect(free.tokens).toBe(9000)
    expect(free.percent).toBeCloseTo(90, 5)
  })

  it('omits empty components and survives a zero total', () => {
    const slices = breakdownSlices(breakdown, 0, 10_000)
    expect(slices.map((s) => s.key)).toEqual(['free'])
    expect(slices.some((s) => s.key === 'mcpTools')).toBe(false)
  })
})
