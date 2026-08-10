import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import type { GitInfo } from '@shared/models'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 10_000 })
  return stdout.trim()
}

/**
 * Detect a linked worktree from one `rev-parse` call: for a worktree the
 * git-dir lives under `<main>/.git/worktrees/<name>` while the common dir is
 * the main repo's `.git`. Returns undefined outside a repo.
 */
async function worktreeInfo(
  cwd: string,
): Promise<{ isWorktree: boolean; mainRepoPath?: string } | undefined> {
  try {
    const out = await git(cwd, ['rev-parse', '--absolute-git-dir', '--git-common-dir'])
    const [gitDir, commonDirRaw] = out.split('\n').map((l) => l.trim())
    if (!gitDir || !commonDirRaw) return undefined
    // --git-common-dir may be relative (".git" at the repo root).
    const commonDir = resolve(cwd, commonDirRaw)
    if (gitDir === commonDir) return { isWorktree: false }
    return { isWorktree: true, mainRepoPath: dirname(commonDir) }
  } catch {
    return undefined
  }
}

export async function gitInfo(workspacePath: string): Promise<GitInfo> {
  try {
    const branch = await git(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const info: GitInfo = { isRepo: true, branch }

    const wt = await worktreeInfo(workspacePath)
    if (wt) {
      info.isWorktree = wt.isWorktree
      if (wt.mainRepoPath) info.mainRepoPath = wt.mainRepoPath
    }

    try {
      const status = await git(workspacePath, ['status', '--porcelain'])
      info.dirtyCount = status ? status.split('\n').filter(Boolean).length : 0
    } catch {
      // ignore
    }

    try {
      const counts = await git(workspacePath, [
        'rev-list',
        '--left-right',
        '--count',
        '@{upstream}...HEAD',
      ])
      const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10))
      info.behind = behind ?? 0
      info.ahead = ahead ?? 0
    } catch {
      // no upstream — fine
    }

    return info
  } catch {
    return { isRepo: false }
  }
}

// ---------- batched, cached summaries for the sidebar ----------

interface CacheEntry {
  at: number
  value: Promise<GitInfo>
}

const CACHE_TTL_MS = 5_000
const summaryCache = new Map<string, CacheEntry>()

/**
 * Cheap per-cwd summary for sidebar rows: branch, worktree flag, dirty count.
 * Skips ahead/behind (an extra rev-list per cwd that rows don't show).
 */
async function gitSummary(cwd: string): Promise<GitInfo> {
  try {
    const out = await git(cwd, [
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
      '--absolute-git-dir',
      '--git-common-dir',
    ])
    const [branch, gitDir, commonDirRaw] = out.split('\n').map((l) => l.trim())
    const info: GitInfo = { isRepo: true, branch }
    const commonDir = commonDirRaw ? resolve(cwd, commonDirRaw) : undefined
    if (gitDir && commonDir && gitDir !== commonDir) {
      info.isWorktree = true
      info.mainRepoPath = dirname(commonDir)
    } else {
      info.isWorktree = false
    }
    try {
      const status = await git(cwd, ['status', '--porcelain'])
      info.dirtyCount = status ? status.split('\n').filter(Boolean).length : 0
    } catch {
      // ignore
    }
    return info
  } catch {
    return { isRepo: false }
  }
}

/**
 * Batch git summaries with a short TTL cache and in-flight dedupe. Sidebar
 * rows share cwds (sessions group by folder), so a large sidebar resolves to
 * a handful of actual git invocations, capped at 4 concurrent.
 */
export async function gitInfoBatch(cwds: string[]): Promise<Record<string, GitInfo>> {
  const unique = [...new Set(cwds)].filter(Boolean)
  const result: Record<string, GitInfo> = {}
  const queue = [...unique]
  const worker = async (): Promise<void> => {
    for (let cwd = queue.shift(); cwd !== undefined; cwd = queue.shift()) {
      const cached = summaryCache.get(cwd)
      let promise: Promise<GitInfo>
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        promise = cached.value
      } else {
        promise = gitSummary(cwd)
        summaryCache.set(cwd, { at: Date.now(), value: promise })
      }
      result[cwd] = await promise
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker))
  return result
}
