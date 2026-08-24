import { describe, it, expect } from 'vitest'
import {
  basename,
  dirname,
  isWorktreeFolder,
  splitPath,
  workspaceName,
  worktreeAwareName,
} from './path'

describe('isWorktreeFolder', () => {
  it('flags a path inside a repo worktree folder', () => {
    expect(isWorktreeFolder('/home/u/pidex/.pidex/worktrees/some-task')).toBe(true)
    expect(isWorktreeFolder('C:\\Users\\u\\pidex\\.pidex\\worktrees\\task')).toBe(true)
  })

  it('does not flag the main repo, another workspace, or a session dir', () => {
    expect(isWorktreeFolder('/home/u/pidex')).toBe(false)
    expect(isWorktreeFolder('/home/u/games')).toBe(false)
    expect(isWorktreeFolder('/home/u/.pi/agent/sessions/--x--')).toBe(false)
  })

  it('requires the folder component, not just the substring', () => {
    expect(isWorktreeFolder('/home/u/pidex/.pidex/worktrees2/x')).toBe(false)
    expect(isWorktreeFolder('/home/u/pidexworktrees/x')).toBe(false)
  })
})

// Existing suite below
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

describe('worktreeAwareName', () => {
  it('falls back to the folder basename when there is no git info', () => {
    expect(worktreeAwareName('/Users/u/pidex/.pidex/worktrees/main')).toBe('main')
  })

  it('falls back to the folder basename outside a worktree', () => {
    expect(worktreeAwareName('/Users/u/pidex', { isWorktree: false })).toBe('pidex')
  })

  it('uses "repo (branch)" for a linked worktree, not the folder name', () => {
    // The regression this guards: a worktree folder named after its own
    // branch (".../worktrees/main") must not read as if the app were "main".
    expect(
      worktreeAwareName('/Users/u/pidex/.pidex/worktrees/main', {
        isWorktree: true,
        mainRepoPath: '/Users/u/pidex',
        branch: 'main',
      }),
    ).toBe('pidex (main)')
  })

  it('falls back to just the repo name when the branch is unknown', () => {
    expect(
      worktreeAwareName('/Users/u/pidex/.pidex/worktrees/main', {
        isWorktree: true,
        mainRepoPath: '/Users/u/pidex',
      }),
    ).toBe('pidex')
  })

  it('ignores mainRepoPath when isWorktree is false', () => {
    expect(
      worktreeAwareName('/Users/u/pidex/.pidex/worktrees/main', {
        isWorktree: false,
        mainRepoPath: '/Users/u/pidex',
        branch: 'main',
      }),
    ).toBe('main')
  })
})
