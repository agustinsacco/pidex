import { describe, expect, it } from 'vitest'
import { pruneSeenSessions } from './prefs-utils'

describe('pruneSeenSessions', () => {
  it('returns the same map while under the cap', () => {
    const seen = { '/a': 1, '/b': 2 }
    expect(pruneSeenSessions(seen)).toBe(seen)
  })

  it('keeps the newest entries once over the cap', () => {
    const seen = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/s${i}`, i]))
    const pruned = pruneSeenSessions(seen, 8, 5)
    expect(Object.keys(pruned)).toHaveLength(5)
    expect(pruned['/s9']).toBe(9)
    expect(pruned['/s5']).toBe(5)
    expect(pruned['/s4']).toBeUndefined()
  })

  it('does not prune at exactly the cap', () => {
    const seen = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/s${i}`, i]))
    expect(pruneSeenSessions(seen, 8, 5)).toBe(seen)
  })
})
