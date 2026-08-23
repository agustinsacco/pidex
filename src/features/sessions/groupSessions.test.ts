import { describe, expect, it } from 'vitest'
import type { GitInfo, SessionMeta } from '@shared/models'
import { groupSessionsByProject, pendingSessionsByGroup } from './groupSessions'

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
          createdAt: '2026-08-10T00:00:00.000Z',
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
    // newest-created first, each still carrying its own (worktree) cwd.
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

  it('keeps separate projects in the supplied workspace order', () => {
    const groups = groupSessionsByProject(
      ['/repo-b', '/repo-a'],
      { '/repo-a': [meta({ cwd: '/repo-a' })], '/repo-b': [meta({ cwd: '/repo-b' })] },
      {},
      notPinned,
      notLive,
      '/repo-a',
    )
    expect(groups.map((g) => g.name)).toEqual(['repo-b', 'repo-a'])
  })

  it('does not promote active, live, or recently changed workspaces', () => {
    const groups = groupSessionsByProject(
      ['/repo-a', '/repo-b', '/repo-c'],
      {
        '/repo-a': [meta({ cwd: '/repo-a', mtimeMs: 100 })],
        '/repo-b': [meta({ cwd: '/repo-b', mtimeMs: 300 })],
        '/repo-c': [meta({ cwd: '/repo-c', mtimeMs: 200 })],
      },
      {},
      notPinned,
      (session) => session.cwd === '/repo-b',
      '/repo-c',
    )
    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo-a', '/repo-b', '/repo-c'])
  })

  it('keeps session rows in creation order when older sessions get new activity', () => {
    const sessions = groupSessionsByProject(
      ['/repo'],
      {
        '/repo': [
          meta({
            path: '/repo/older.jsonl',
            createdAt: '2026-08-01T00:00:00.000Z',
            mtimeMs: 300,
          }),
          meta({
            path: '/repo/newer.jsonl',
            createdAt: '2026-08-02T00:00:00.000Z',
            mtimeMs: 100,
          }),
        ],
      },
      {},
      notPinned,
      notLive,
      '/repo',
    )

    expect(sessions[0]?.metas.map((session) => session.path)).toEqual([
      '/repo/newer.jsonl',
      '/repo/older.jsonl',
    ])
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

describe('pendingSessionsByGroup', () => {
  const groups = [{ workspacePath: '/repo', paths: ['/repo'] }]

  it('is pending while diskPath is unknown', () => {
    const live = [{ pidexId: 'p1', workspacePath: '/repo' }]
    const pending = pendingSessionsByGroup(live, new Set(), groups)
    expect(pending.get('/repo')).toEqual(['p1'])
  })

  it('stays pending once diskPath is known but the scan has not caught up yet', () => {
    // Regression: get_state can resolve `diskPath` well before pi's file
    // shows up in a `disk` scan (write + watcher awaitWriteFinish + debounce
    // all still have to happen). Gating on "diskPath known" alone dropped the
    // placeholder during that gap and left the row missing.
    const live = [{ pidexId: 'p1', workspacePath: '/repo', diskPath: '/repo/a.jsonl' }]
    const pending = pendingSessionsByGroup(live, new Set(), groups)
    expect(pending.get('/repo')).toEqual(['p1'])
  })

  it('drops out once the disk scan actually contains the session', () => {
    const live = [{ pidexId: 'p1', workspacePath: '/repo', diskPath: '/repo/a.jsonl' }]
    const pending = pendingSessionsByGroup(live, new Set(['/repo/a.jsonl']), groups)
    expect(pending.has('/repo')).toBe(false)
  })

  it('keys a pending worktree session by its main-repo group, not its own path', () => {
    const foldedGroups = [
      { workspacePath: '/repo', paths: ['/repo', '/repo/.pidex/worktrees/test'] },
    ]
    const live = [{ pidexId: 'p1', workspacePath: '/repo/.pidex/worktrees/test' }]
    const pending = pendingSessionsByGroup(live, new Set(), foldedGroups)
    expect(pending.get('/repo')).toEqual(['p1'])
  })
})
