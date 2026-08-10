import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { AddWorktreeBranch, BranchInfo, WorktreeInfo } from '@shared/models'

const execFileAsync = promisify(execFile)

/**
 * Worktree lifecycle for pidex sessions.
 *
 * Layout decision: worktrees live INSIDE the repo at
 * `<repo>/.pidex/worktrees/<name>` (mirroring the `.claude/worktrees`
 * convention), ignored via `.git/info/exclude` so `git status` stays clean
 * without touching tracked files. In-repo keeps them discoverable and gives
 * sidebar groups a meaningful name (groups are keyed by cwd basename).
 *
 * Two standing rules:
 * - The main tree's checkout is NEVER changed on the user's behalf.
 * - Nothing uncommitted is deleted without an explicit force.
 */

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/** Both dir name and branch name — reject anything path- or ref-hostile. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function worktreeRootFor(repoPath: string): string {
  return join(repoPath, '.pidex', 'worktrees')
}

/**
 * Resolve symlinks the way pi does (`realpathSync.native`) so worktree paths
 * compare equal to session cwds.
 */
export function normalizeRealPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Parse `git worktree list --porcelain` output. Exported pure for tests. */
export function parseWorktreeList(
  output: string,
): Array<Pick<WorktreeInfo, 'path' | 'branch' | 'head' | 'locked' | 'prunable'>> {
  const result: Array<Pick<WorktreeInfo, 'path' | 'branch' | 'head' | 'locked' | 'prunable'>> = []
  let current: {
    path?: string
    branch: string | null
    head: string
    locked: boolean
    prunable: boolean
  } | null = null
  const flush = (): void => {
    if (current?.path) {
      result.push({
        path: current.path,
        branch: current.branch,
        head: current.head,
        locked: current.locked,
        prunable: current.prunable,
      })
    }
    current = null
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice(9), branch: null, head: '', locked: false, prunable: false }
    } else if (!current) {
      continue
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true
    } else if (line === 'detached') {
      current.branch = null
    }
  }
  flush()
  return result
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const parsed = parseWorktreeList(await git(repoPath, ['worktree', 'list', '--porcelain']))
  const mainPath = parsed[0]?.path
  return Promise.all(
    parsed.map(async (wt) => {
      let dirtyCount = -1
      if (existsSync(wt.path)) {
        try {
          const status = await git(wt.path, ['status', '--porcelain'])
          dirtyCount = status.trim() ? status.trim().split('\n').length : 0
        } catch {
          dirtyCount = -1
        }
      }
      return {
        ...wt,
        realPath: normalizeRealPath(wt.path),
        isMain: wt.path === mainPath,
        dirtyCount,
      }
    }),
  )
}

export async function listBranches(
  repoPath: string,
): Promise<{ branches: BranchInfo[]; defaultBranch: string }> {
  const [refs, worktrees, currentBranch] = await Promise.all([
    git(repoPath, [
      'for-each-ref',
      'refs/heads',
      '--format=%(refname:short)\t%(committerdate:unix)\t%(subject)',
    ]),
    listWorktrees(repoPath),
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim()),
  ])

  const byBranch = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch!, w.path]))
  const branches: BranchInfo[] = refs
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', date = '', ...subject] = line.split('\t')
      return {
        name,
        isCurrent: name === currentBranch,
        worktreePath: byBranch.get(name),
        lastCommitSubject: subject.join('\t') || undefined,
        lastCommitAt: date ? Number.parseInt(date, 10) * 1000 : undefined,
      }
    })
    .sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0))

  let defaultBranch: string
  try {
    defaultBranch = (await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))
      .trim()
      .replace(/^origin\//, '')
  } catch {
    const names = new Set(branches.map((b) => b.name))
    defaultBranch = names.has('main') ? 'main' : names.has('master') ? 'master' : currentBranch
  }
  return { branches, defaultBranch }
}

/** Append `/.pidex/` to .git/info/exclude once (never touches .gitignore). */
async function ensureExcluded(repoPath: string): Promise<void> {
  const commonDir = (
    await git(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  const excludePath = join(commonDir, 'info', 'exclude')
  let existing = ''
  try {
    existing = await readFile(excludePath, 'utf8')
  } catch {
    // no exclude file yet
  }
  if (existing.split('\n').some((l) => l.trim() === '/.pidex/')) return
  await mkdir(join(commonDir, 'info'), { recursive: true })
  await appendFile(excludePath, `${existing.endsWith('\n') || !existing ? '' : '\n'}/.pidex/\n`)
}

export async function addWorktree(
  repoPath: string,
  name: string,
  branch: AddWorktreeBranch,
): Promise<WorktreeInfo> {
  if (!NAME_PATTERN.test(name) || name.includes('..')) {
    throw new Error(`Invalid worktree name "${name}" — letters, digits, ./_- only.`)
  }
  const path = join(worktreeRootFor(repoPath), name)
  if (existsSync(path)) {
    throw new Error(`Worktree folder already exists: ${path}`)
  }

  if (branch.kind === 'existing') {
    const worktrees = await listWorktrees(repoPath)
    const taken = worktrees.find((w) => w.branch === branch.branch)
    if (taken) {
      throw new Error(
        `Branch "${branch.branch}" is already checked out in ${taken.isMain ? 'the main tree' : taken.path}.`,
      )
    }
  }

  await mkdir(worktreeRootFor(repoPath), { recursive: true })
  await ensureExcluded(repoPath)

  if (branch.kind === 'new') {
    await git(repoPath, ['worktree', 'add', '-b', name, path, branch.base])
  } else {
    await git(repoPath, ['worktree', 'add', path, branch.branch])
  }

  const worktrees = await listWorktrees(repoPath)
  const created = worktrees.find((w) => w.path === path || w.realPath === normalizeRealPath(path))
  if (!created) throw new Error('Worktree was created but not found in `git worktree list`.')
  return created
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<
  | { removed: true; branchDeleted: boolean; branchError?: string }
  | { removed: false; dirtyCount: number }
> {
  const worktrees = await listWorktrees(repoPath)
  const target = worktrees.find(
    (w) => w.path === worktreePath || w.realPath === normalizeRealPath(worktreePath),
  )
  if (!target) throw new Error(`Not a linked worktree of this repo: ${worktreePath}`)
  if (target.isMain) throw new Error('Refusing to remove the main working tree.')

  if (!options.force && target.dirtyCount > 0) {
    return { removed: false, dirtyCount: target.dirtyCount }
  }

  const args = ['worktree', 'remove']
  if (options.force) args.push('--force')
  args.push(target.path)
  await git(repoPath, args)

  let branchDeleted = false
  let branchError: string | undefined
  if (options.deleteBranch && target.branch) {
    try {
      // Only ever `-d`: an unmerged branch stays and is reported, never lost.
      await git(repoPath, ['branch', '-d', target.branch])
      branchDeleted = true
    } catch (error) {
      branchError = error instanceof Error ? error.message : String(error)
    }
  }
  return { removed: true, branchDeleted, branchError }
}

export async function pruneWorktrees(repoPath: string): Promise<{ pruned: string[] }> {
  // --verbose reports removals on stderr.
  const { stdout, stderr } = await execFileAsync('git', ['worktree', 'prune', '--verbose'], {
    cwd: repoPath,
    timeout: 30_000,
  })
  const pruned = `${stdout}\n${stderr}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return { pruned }
}

/** Stage everything and commit in the worktree. Refuses empty messages. */
export async function commitAll(worktreePath: string, message: string): Promise<{ sha: string }> {
  if (!message.trim()) throw new Error('Commit message must not be empty.')
  await git(worktreePath, ['add', '-A'])
  await git(worktreePath, ['commit', '-m', message])
  return { sha: (await git(worktreePath, ['rev-parse', 'HEAD'])).trim() }
}

/**
 * Merge `branch` into the main tree's current branch. Preflight requires the
 * main tree to be clean (we never checkout or stash for the user); a conflict
 * aborts immediately so the repo is never left mid-merge.
 */
export async function mergeBranch(
  repoPath: string,
  branch: string,
): Promise<
  | { merged: true; sha: string }
  | { merged: false; reason: 'dirty'; dirtyCount: number }
  | { merged: false; reason: 'conflict'; conflicts: string[] }
> {
  const status = (await git(repoPath, ['status', '--porcelain'])).trim()
  if (status) {
    return { merged: false, reason: 'dirty', dirtyCount: status.split('\n').length }
  }
  try {
    await git(repoPath, ['merge', '--no-ff', '--no-edit', branch])
  } catch {
    let conflicts: string[] = []
    try {
      conflicts = (await git(repoPath, ['diff', '--name-only', '--diff-filter=U']))
        .split('\n')
        .filter(Boolean)
    } catch {
      // ignore
    }
    try {
      await git(repoPath, ['merge', '--abort'])
    } catch {
      // no merge in progress (e.g. the failure predated the merge)
    }
    return { merged: false, reason: 'conflict', conflicts }
  }
  return { merged: true, sha: (await git(repoPath, ['rev-parse', 'HEAD'])).trim() }
}
