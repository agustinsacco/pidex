import { describe, expect, it } from 'vitest'
import {
  isPaidWindow,
  parseRateLimit,
  resetLabel,
  utilizationPercent,
  windowLabel,
} from './rateLimit'

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
      // This capture predates provider 0.4.9, which is exactly the
      // older-provider case: window and reset, but no percentage.
      utilization: null,
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

// Captured verbatim from claude 2.1.231 on a Team account that had gone past
// its usage-credit allowance — the case that motivated showing a percentage.
const OVER_CREDITS = JSON.stringify({
  status: 'allowed_warning',
  resetsAt: 1788220800,
  rateLimitType: 'overage',
  utilization: 1.01,
  isUsingOverage: false,
  surpassedThreshold: 1,
})

describe('utilization (provider >= 0.4.9)', () => {
  it('parses the percentage the older provider never sent', () => {
    expect(parseRateLimit(OVER_CREDITS)?.utilization).toBe(1.01)
  })

  it('is null on an older provider payload, not zero', () => {
    // "Unknown" and "none used" must not look the same: a 0% bar reads as
    // plenty of room left.
    const legacy = JSON.stringify({ status: 'allowed', rateLimitType: 'five_hour' })
    expect(parseRateLimit(legacy)?.utilization).toBeNull()
  })

  it('ignores non-finite and non-numeric values', () => {
    for (const bad of [NaN, Infinity, '1.01', null]) {
      const raw = JSON.stringify({ rateLimitType: 'five_hour', utilization: bad })
      expect(parseRateLimit(raw)?.utilization).toBeNull()
    }
  })

  it('converts to a whole percentage, keeping over-100 visible', () => {
    expect(utilizationPercent(1.01)).toBe(101)
    expect(utilizationPercent(0.14)).toBe(14)
    expect(utilizationPercent(0)).toBe(0)
    expect(utilizationPercent(null)).toBeNull()
  })

  it('never returns a negative percentage', () => {
    expect(utilizationPercent(-0.5)).toBe(0)
  })
})

describe('window labels', () => {
  it('names the credit bucket as money, not as a plan window', () => {
    // "overage limit" hid that this bucket bills at standard API rates.
    expect(windowLabel('overage')).toBe('Usage credits')
    expect(isPaidWindow('overage')).toBe(true)
  })

  it('treats plan windows as unpaid', () => {
    for (const w of ['five_hour', 'seven_day', 'seven_day_oauth_apps']) {
      expect(isPaidWindow(w)).toBe(false)
    }
  })

  it('labels the credits-included weekly window distinctly', () => {
    expect(windowLabel('seven_day_overage_included')).toBe('Weekly limit (incl. credits)')
  })
})

describe('the over-credits state (what a real Team account hit)', () => {
  const parsed = parseRateLimit(OVER_CREDITS)!

  it('reports 101%, not a clamped 100%', () => {
    // Clamping here would hide that money is being spent past the allowance.
    expect(utilizationPercent(parsed.utilization)).toBe(101)
  })

  it('names it as credits and marks it paid', () => {
    expect(windowLabel(parsed.windowType)).toBe('Usage credits')
    expect(isPaidWindow(parsed.windowType)).toBe(true)
  })

  it('is not flagged as isUsingOverage, so the UI must not rely on that field', () => {
    // The CLI hardcodes this false on the warning path — the percentage and
    // the window type are the only trustworthy signals.
    expect(parsed.isUsingOverage).toBe(false)
  })
})
