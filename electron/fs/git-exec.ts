import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * The one `git` runner for the main process.
 *
 * `git-info`, `git-service`, `git-sync` and `git-worktrees` each used to
 * declare their own, and the limits had drifted to four different values for
 * no stated reason (10s/1MB, 20s/64MB, 30s/16MB, 30s/16MB). The 1MB default in
 * `git-info` was the one that mattered: `git status --porcelain` on a very
 * large dirty tree overflows it and the caller's `catch` swallows that as "no
 * dirty count". One documented pair of limits — the widest of the four —
 * applies everywhere now.
 */

export interface GitOptions {
  /** Return '' instead of throwing when git exits non-zero. */
  allowFail?: boolean
  /**
   * Trim surrounding whitespace off stdout. Explicit rather than the default:
   * single-value queries (`rev-parse`, `symbolic-ref`) want it, line-oriented
   * output usually filters empties itself.
   */
  trim?: boolean
}

const TIMEOUT_MS = 30_000
const MAX_BUFFER = 64 * 1024 * 1024

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    return options.trim ? stdout.trim() : stdout
  } catch (error) {
    if (options.allowFail) return ''
    throw error
  }
}

/**
 * Number of entries in `git status --porcelain`.
 *
 * Trim first, then drop empties: porcelain output ends in a newline, so
 * counting the raw split reports one entry too many, and a clean tree ('')
 * splits to a single empty string rather than nothing. The four hand-rolled
 * versions this replaces each got a different subset of that right.
 */
export async function dirtyCount(cwd: string): Promise<number> {
  const status = await git(cwd, ['status', '--porcelain'])
  return status.trim().split('\n').filter(Boolean).length
}

/**
 * Collect the conflicted paths of a failed merge, then put the tree back.
 *
 * Both calls tolerate failure on purpose: the conflict list is diagnostic
 * only, and `merge --abort` fails when there is no merge in progress (the
 * original failure predated it). Either way pidex never leaves a tree
 * mid-merge.
 */
export async function abortMergeAndCollectConflicts(cwd: string): Promise<string[]> {
  const conflicts = (
    await git(cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })
  )
    .split('\n')
    .filter(Boolean)
  await git(cwd, ['merge', '--abort'], { allowFail: true })
  return conflicts
}
