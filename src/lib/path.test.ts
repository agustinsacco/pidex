import { describe, it, expect } from 'vitest'
import { basename, dirname, splitPath, workspaceName } from './path'

describe('basename', () => {
  it.each([
    ['src/lib/a.ts', 'a.ts'],
    ['a.ts', 'a.ts'],
    ['C:\\Users\\a\\b.ts', 'b.ts'],
    ['/abs/path/c.ts', 'c.ts'],
  ])('reduces %s to %s', (input, expected) => {
    expect(basename(input)).toBe(expected)
  })

  it('falls back to the whole path when it ends in a separator', () => {
    expect(basename('src/lib/')).toBe('src/lib/')
  })

  it('returns an empty string unchanged', () => {
    expect(basename('')).toBe('')
  })
})

describe('dirname', () => {
  it.each([
    ['src/lib/a.ts', 'src/lib'],
    ['/abs/a.ts', '/abs'],
    ['C:\\Users\\a.ts', 'C:\\Users'],
  ])('reduces %s to %s', (input, expected) => {
    expect(dirname(input)).toBe(expected)
  })

  it('returns an empty string when there is no directory part', () => {
    expect(dirname('a.ts')).toBe('')
  })

  it('handles a root-level file', () => {
    expect(dirname('/a.ts')).toBe('')
  })

  it('uses the last separator when both kinds are present', () => {
    expect(dirname('C:\\Users/mixed/a.ts')).toBe('C:\\Users/mixed')
  })
})

describe('splitPath', () => {
  it('splits directory and basename together', () => {
    expect(splitPath('src/lib/a.ts')).toEqual({ dir: 'src/lib', base: 'a.ts' })
  })

  it('yields an empty dir for a bare filename', () => {
    expect(splitPath('a.ts')).toEqual({ dir: '', base: 'a.ts' })
  })
})

describe('workspaceName', () => {
  it.each([
    ['/home/u/proj', 'proj'],
    ['/home/u/proj/', 'proj'],
    ['/home/u/proj///', 'proj'],
    ['C:\\Users\\u\\proj', 'proj'],
  ])('names %s as %s', (input, expected) => {
    expect(workspaceName(input)).toBe(expected)
  })

  it('falls back to the input when there are no real segments', () => {
    expect(workspaceName('/')).toBe('/')
  })
})
