import { describe, it, expect } from 'vitest'
import { autoMarker, laneMarker, allMarkers, AUTO_MARKERS, MARKER_CATEGORIES } from './laneMarker'

describe('autoMarker', () => {
  it('is stable for the same key', () => {
    expect(autoMarker('pidex/lane-a')).toBe(autoMarker('pidex/lane-a'))
  })

  it('always returns a glyph, even with no key', () => {
    expect(autoMarker(undefined)).toBeTruthy()
    expect(autoMarker('')).toBeTruthy()
    expect(autoMarker(null)).toBeTruthy()
  })

  it('only ever returns glyphs from the auto palette', () => {
    for (let i = 0; i < 200; i++) {
      expect(AUTO_MARKERS).toContain(autoMarker(`pidex/branch-${i}`))
    }
  })

  it('spreads realistic branch names across most of the palette', () => {
    // A hash that clumps would give every lane in a repo the same glyph, which
    // is the one failure mode that makes the whole feature pointless.
    const branches = Array.from({ length: 40 }, (_, i) => `pidex/feature-${i}`)
    const distinct = new Set(branches.map(autoMarker))
    expect(distinct.size).toBeGreaterThanOrEqual(20)
  })

  it('gives sibling branch names different glyphs', () => {
    expect(autoMarker('pidex/lane-a')).not.toBe(autoMarker('pidex/lane-b'))
  })
})

describe('laneMarker', () => {
  it('prefers an explicit choice', () => {
    expect(laneMarker('🐙', 'pidex/x', '/cwd')).toBe('🐙')
  })

  it('honours an explicit empty string as "no marker, on purpose"', () => {
    expect(laneMarker('', 'pidex/x', '/cwd')).toBe('')
  })

  it('falls back to the branch hash, not the cwd, when both exist', () => {
    expect(laneMarker(undefined, 'pidex/x', '/cwd')).toBe(autoMarker('pidex/x'))
  })

  it('falls back to cwd when the lane has no branch yet', () => {
    expect(laneMarker(undefined, null, '/repo/lane')).toBe(autoMarker('/repo/lane'))
  })

  it('never returns blank for a lane that never chose', () => {
    expect(laneMarker(undefined, null, null)).toBeTruthy()
  })
})

describe('palette', () => {
  it('has no duplicates within the picker', () => {
    const all = allMarkers()
    expect(new Set(all).size).toBe(all.length)
  })

  it('offers four named categories of twenty', () => {
    expect(MARKER_CATEGORIES).toHaveLength(4)
    for (const category of MARKER_CATEGORIES) expect(category.markers).toHaveLength(20)
  })

  it('draws the auto palette from glyphs the picker also offers', () => {
    const pickable = new Set(allMarkers())
    for (const marker of AUTO_MARKERS) expect(pickable.has(marker)).toBe(true)
  })
})
