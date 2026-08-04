import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyFilter } from './fuzzy'

describe('fuzzyMatch', () => {
  it('scores an empty query as 0 without inspecting the target', () => {
    expect(fuzzyMatch('', 'anything')).toBe(0)
  })

  it('returns null when the query is not a subsequence of the target', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('abcd', 'abc')).toBeNull()
  })

  it('matches a subsequence that is not contiguous', () => {
    expect(fuzzyMatch('ac', 'abc')).not.toBeNull()
  })

  it('is case-insensitive in both directions', () => {
    expect(fuzzyMatch('ABC', 'abc')).toBe(fuzzyMatch('abc', 'ABC'))
  })

  it('rewards contiguous runs over scattered matches', () => {
    const contiguous = fuzzyMatch('abc', 'abcxxxxx')!
    const scattered = fuzzyMatch('abc', 'axbxcxxx')!
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('rewards matches at path and word boundaries', () => {
    const boundary = fuzzyMatch('f', 'src/foo')!
    const midWord = fuzzyMatch('f', 'srcxfoo'.replace('foo', 'oof'))!
    expect(boundary).toBeGreaterThan(midWord)
  })

  it('treats /, -, _ and . as boundaries', () => {
    for (const sep of ['/', '-', '_', '.']) {
      expect(fuzzyMatch('b', `a${sep}b`)!).toBeGreaterThan(fuzzyMatch('b', 'axb')!)
    }
  })

  it('penalizes longer targets', () => {
    const short = fuzzyMatch('abc', 'abc')!
    const long = fuzzyMatch('abc', 'abc' + 'x'.repeat(80))!
    expect(short).toBeGreaterThan(long)
  })

  it('gives a basename bonus when the first query char appears after the last slash', () => {
    const inBasename = fuzzyMatch('z', 'aaa/zzz')!
    const inDirOnly = fuzzyMatch('z', 'zzz/aaa')!
    expect(inBasename).toBeGreaterThan(inDirOnly)
  })
})

describe('fuzzyFilter', () => {
  const items = ['src/app/App.tsx', 'src/lib/fuzzy.ts', 'README.md']
  const identity = (s: string): string => s

  it('returns the head of the list unfiltered for an empty query', () => {
    expect(fuzzyFilter('', items, identity)).toEqual(items)
  })

  it('respects the limit when the query is empty', () => {
    expect(fuzzyFilter('', items, identity, 2)).toEqual(items.slice(0, 2))
  })

  it('drops non-matching items', () => {
    expect(fuzzyFilter('fuzzy', items, identity)).toEqual(['src/lib/fuzzy.ts'])
  })

  it('orders results by descending score', () => {
    const result = fuzzyFilter('app', ['zzz/app-thing', 'src/app/App.tsx'], identity)
    expect(result.length).toBe(2)
    // Both match; the ordering is score-driven, not input-driven.
    const scores = result.map((r) => fuzzyMatch('app', r)!)
    expect(scores[0]!).toBeGreaterThanOrEqual(scores[1]!)
  })

  it('caps the number of results at the limit', () => {
    const many = Array.from({ length: 100 }, (_, i) => `file${i}.ts`)
    expect(fuzzyFilter('file', many, identity, 10).length).toBe(10)
  })

  it('uses the key selector to read the match target', () => {
    const objects = [{ path: 'src/lib/fuzzy.ts' }, { path: 'README.md' }]
    expect(fuzzyFilter('fuzzy', objects, (o) => o.path)).toEqual([{ path: 'src/lib/fuzzy.ts' }])
  })
})
