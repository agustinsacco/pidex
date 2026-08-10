import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addWorktree,
  commitAll,
  listBranches,
  listWorktrees,
  mergeBranch,
  parseWorktreeList,
  pruneWorktrees,
  removeWorktree,
  worktreeRootFor,
} from '../git-worktrees'

const execFileAsync = promisify(execFile)

let repo: string

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'pidex-wt-'))
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.email', 'test@pidex.dev'])
  await git(repo, ['config', 'user.name', 'pidex test'])
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '-m', 'initial'])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('parseWorktreeList', () => {
  it('parses main + linked + detached + prunable entries', () => {
    const parsed = parseWorktreeList(
      [
        'worktree /repo',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        'worktree /repo/.pidex/worktrees/task',
        'HEAD 2222222222222222222222222222222222222222',
        'branch refs/heads/task',
        'locked reason',
        '',
        'worktree /repo/.pidex/worktrees/gone',
        'HEAD 3333333333333333333333333333333333333333',
        'detached',
        'prunable gitdir file points to non-existent location',
        '',
      ].join('\n'),
    )
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({ path: '/repo', branch: 'main', locked: false })
    expect(parsed[1]).toMatchObject({ branch: 'task', locked: true })
    expect(parsed[2]).toMatchObject({ branch: null, prunable: true })
  })
})

describe('git-worktrees (real git)', () => {
  it('adds a worktree on a new branch and excludes /.pidex/', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    expect(created.branch).toBe('task-1')
    expect(created.isMain).toBe(false)
    expect(existsSync(join(worktreeRootFor(repo), 'task-1'))).toBe(true)

    // /.pidex/ excluded → main status stays clean.
    expect(await git(repo, ['status', '--porcelain'])).toBe('')
    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('/.pidex/')

    // Idempotent exclude append.
    await addWorktree(repo, 'task-2', { kind: 'new', base: 'main' })
    const exclude2 = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude2.match(/\/\.pidex\//g)).toHaveLength(1)
  })

  it('refuses names with path separators traversal and duplicates', async () => {
    await expect(addWorktree(repo, '../evil', { kind: 'new', base: 'main' })).rejects.toThrow(
      /Invalid worktree name/,
    )
    await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await expect(addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })).rejects.toThrow()
  })

  it('opens an existing branch as a worktree, refusing already-checked-out ones', async () => {
    await git(repo, ['branch', 'feature-x'])
    const created = await addWorktree(repo, 'feature-x', { kind: 'existing', branch: 'feature-x' })
    expect(created.branch).toBe('feature-x')
    await expect(
      addWorktree(repo, 'feature-x-2', { kind: 'existing', branch: 'main' }),
    ).rejects.toThrow(/already checked out/)
  })

  it('lists branches with worktree associations and a default', async () => {
    await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    const { branches, defaultBranch } = await listBranches(repo)
    expect(defaultBranch).toBe('main')
    const task = branches.find((b) => b.name === 'task-1')
    expect(task?.worktreePath).toContain('task-1')
    expect(branches.find((b) => b.name === 'main')?.isCurrent).toBe(true)
  })

  it('guards dirty worktrees on remove, honors force, and -d only for branches', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await writeFile(join(created.path, 'b.txt'), 'uncommitted\n')

    const refused = await removeWorktree(repo, created.path, {})
    expect(refused).toEqual({ removed: false, dirtyCount: 1 })
    expect(existsSync(created.path)).toBe(true)

    // Forced: removed, but the (unmerged-with-nothing) branch survives -d
    // only if merged; task-1 points at main's HEAD so -d succeeds.
    const removed = await removeWorktree(repo, created.path, { force: true, deleteBranch: true })
    expect(removed).toMatchObject({ removed: true, branchDeleted: true })
    expect(existsSync(created.path)).toBe(false)
  })

  it('keeps unmerged branches on delete and reports the error', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await writeFile(join(created.path, 'c.txt'), 'work\n')
    await commitAll(created.path, 'work on task-1')

    const result = await removeWorktree(repo, created.path, { deleteBranch: true })
    expect(result).toMatchObject({ removed: true, branchDeleted: false })
    if (result.removed) expect(result.branchError).toBeTruthy()
    expect(await git(repo, ['branch', '--list', 'task-1'])).toContain('task-1')
  })

  it('prunes after a manual folder delete', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await rm(created.path, { recursive: true, force: true })
    const { pruned } = await pruneWorktrees(repo)
    expect(pruned.length).toBeGreaterThan(0)
    expect((await listWorktrees(repo)).some((w) => w.branch === 'task-1')).toBe(false)
  })

  it('merges a committed worktree branch with --no-ff', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await writeFile(join(created.path, 'c.txt'), 'work\n')
    const { sha } = await commitAll(created.path, 'task work')
    expect(sha).toHaveLength(40)

    const result = await mergeBranch(repo, 'task-1')
    expect(result).toMatchObject({ merged: true })
    expect(existsSync(join(repo, 'c.txt'))).toBe(true)
    // --no-ff → merge commit with two parents.
    expect((await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ')).toHaveLength(3)
  })

  it('refuses to merge onto a dirty main tree', async () => {
    await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await writeFile(join(repo, 'a.txt'), 'local edit\n')
    const result = await mergeBranch(repo, 'task-1')
    expect(result).toMatchObject({ merged: false, reason: 'dirty' })
  })

  it('aborts conflicting merges cleanly (no MERGE_HEAD left)', async () => {
    const created = await addWorktree(repo, 'task-1', { kind: 'new', base: 'main' })
    await writeFile(join(created.path, 'a.txt'), 'worktree version\n')
    await commitAll(created.path, 'worktree edit')
    await writeFile(join(repo, 'a.txt'), 'main version\n')
    await git(repo, ['commit', '-am', 'main edit'])

    const result = await mergeBranch(repo, 'task-1')
    expect(result).toMatchObject({ merged: false, reason: 'conflict' })
    if (!result.merged && result.reason === 'conflict') {
      expect(result.conflicts).toContain('a.txt')
    }
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(await git(repo, ['status', '--porcelain'])).toBe('')
  })

  it('commitAll refuses empty messages', async () => {
    await expect(commitAll(repo, '   ')).rejects.toThrow(/empty/)
  })
})
