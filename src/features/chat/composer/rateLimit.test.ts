import { describe, expect, it } from 'vitest'
import { parseRateLimit, resetLabel, windowLabel } from './rateLimit'

/** Captured live from claude 2.1.237 via the provider's status push. */
const LIVE = JSON.stringify({
  status: 'allowed',
  resetsAt: 1787368800,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  isUsingOverage: false,
  observedAt: 1787363602,
})

describe('parseRateLimit', () => {
  it('parses the live payload', () => {
    expect(parseRateLimit(LIVE)).toEqual({
      status: 'allowed',
      resetsAt: 1787368800,
      windowType: 'five_hour',
      isUsingOverage: false,
      overageStatus: 'rejected',
    })
  })

  it('returns null for absent, malformed, or empty payloads', () => {
    expect(parseRateLimit(undefined)).toBeNull()
    expect(parseRateLimit('nope')).toBeNull()
    // Nothing actionable in it — do not render a section for this.
    expect(parseRateLimit('{"observedAt":123}')).toBeNull()
  })

  it('flags overage', () => {
    const parsed = parseRateLimit('{"status":"allowed","isUsingOverage":true}')
    expect(parsed?.isUsingOverage).toBe(true)
  })
})

describe('windowLabel', () => {
  it('names known windows and degrades readably', () => {
    expect(windowLabel('five_hour')).toBe('5-hour limit')
    expect(windowLabel('seven_day')).toBe('Weekly limit')
    expect(windowLabel('some_future_window')).toBe('some future window')
    expect(windowLabel(null)).toBe('Usage limit')
  })
})

describe('resetLabel', () => {
  const now = 1_787_363_602_000

  it('renders hours and minutes', () => {
    expect(resetLabel(1_787_363_602 + 8640, now)).toBe('Resets in 2 hr 24 min')
    expect(resetLabel(1_787_363_602 + 7200, now)).toBe('Resets in 2 hr')
    expect(resetLabel(1_787_363_602 + 600, now)).toBe('Resets in 10 min')
  })

  it('goes quiet once the window has passed, rather than showing a stale countdown', () => {
    expect(resetLabel(1_787_363_602 - 60, now)).toBeNull()
    expect(resetLabel(null, now)).toBeNull()
  })
})
