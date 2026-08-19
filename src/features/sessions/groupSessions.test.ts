import { describe, expect, it } from 'vitest'
import type { GitInfo, SessionMeta } from '@shared/models'
import { groupSessionsByProject } from './groupSessions'

const meta = (overrides: Partial<SessionMeta> = {}): SessionMeta => ({
  path: '/s.jsonl',
  sessionId: 's',
  cwd: '/repo',
  createdAt: '2026-08-09T00:00:00.000Z',
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 0,
  totalTokens: 100,
  inputTokens: 60,
  outputTokens: 40,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
  entryCount: 2,
  branchCount: 0,
  mtimeMs: Date.now(),
  lastActivityAt: '2026-08-09T00:01:00.000Z',
  ...overrides,
})

const notPinned = (): boolean => false
const notLive = (): boolean => false

describe('groupSessionsByProject', () => {
  it('gives a plain workspace its own group', () => {
    const groups = groupSessionsByProject(
      ['/repo'],
      { '/repo': [meta({ path: '/repo/a.jsonl' })] },
      {},
      notPinned,
      notLive,
      '/repo',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ workspacePath: '/repo', paths: ['/repo'], name: 'repo' })
  })

  it('folds a linked worktree into its main repo group instead of a second header', () => {
    const gitByCwd: Record<string, GitInfo> = {
      '/repo': { isRepo: true, branch: 'main' },
      '/repo/.pidex/worktrees/test': {
        isRepo: true,
        branch: 'test',
        isWorktree: true,
        mainRepoPath: '/repo',
      },
    }
    const disk = {
      '/repo': [meta({ path: '/repo/a.jsonl', cwd: '/repo', mtimeMs: 1000 })],
      '/repo/.pidex/worktrees/test': [
        meta({
          path: '/repo/.pidex/worktrees/test/b.jsonl',
          cwd: '/repo/.pidex/worktrees/test',
          mtimeMs: 2000,
        }),
      ],
    }
    const groups = groupSessionsByProject(
      ['/repo', '/repo/.pidex/worktrees/test'],
      disk,
      gitByCwd,
      notPinned,
      notLive,
      '/repo',
    )

    // One header, not two — this is the bug report: a worktree used to split
    // the sidebar into "repo" and "repo (test)".
    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('repo')
    expect(groups[0]?.paths.sort()).toEqual(['/repo', '/repo/.pidex/worktrees/test'].sort())
    // Sessions from both physical folders show up under the merged group,
    // newest first, each still carrying its own (worktree) cwd.
    expect(groups[0]?.metas.map((m) => m.cwd)).toEqual(['/repo/.pidex/worktrees/test', '/repo'])
  })

  it('falls back to the worktree path when the main repo folder is unknown', () => {
    const gitByCwd: Record<string, GitInfo> = {
      '/somewhere/wt': { isRepo: true, branch: 'test', isWorktree: true, mainRepoPath: '/repo' },
    }
    const groups = groupSessionsByProject(
      ['/somewhere/wt'],
      { '/somewhere/wt': [meta({ path: '/somewhere/wt/a.jsonl', cwd: '/somewhere/wt' })] },
      gitByCwd,
      notPinned,
      notLive,
      '/somewhere/wt',
    )
    expect(groups).toHaveLength(1)
    // Grouped under the (unopened) main repo's name, but the only known
    // physical folder is still the worktree, so that's the action target.
    expect(groups[0]?.name).toBe('repo')
    expect(groups[0]?.workspacePath).toBe('/somewhere/wt')
  })

  it('keeps two separate projects separate', () => {
    const groups = groupSessionsByProject(
      ['/repo-a', '/repo-b'],
      { '/repo-a': [meta({ cwd: '/repo-a' })], '/repo-b': [meta({ cwd: '/repo-b' })] },
      {},
      notPinned,
      notLive,
      '/repo-a',
    )
    expect(groups.map((g) => g.name).sort()).toEqual(['repo-a', 'repo-b'])
  })

  it('excludes pinned sessions and counts live sessions per merged group', () => {
    const pinned = meta({ path: '/repo/pinned.jsonl' })
    const live = meta({ path: '/repo/live.jsonl' })
    const groups = groupSessionsByProject(
      ['/repo'],
      { '/repo': [pinned, live] },
      {},
      (m) => m.path === pinned.path,
      (m) => m.path === live.path,
      '/repo',
    )
    expect(groups[0]?.metas.map((m) => m.path)).toEqual([live.path])
    expect(groups[0]?.liveCount).toBe(1)
  })
})
