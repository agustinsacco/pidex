import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[], allowFail = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    if (allowFail) return ''
    throw error
  }
}

/** Per-file porcelain status for explorer dots: relativePath → XY code. */
export async function gitStatusMap(workspacePath: string): Promise<Record<string, string>> {
  const out = await git(workspacePath, ['status', '--porcelain', '-uall'], true)
  const map: Record<string, string> = {}
  for (const line of out.split('\n')) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    let path = line.slice(3)
    // Renames: "R  old -> new"
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    map[path] = code
  }
  return map
}

/**
 * Session baseline: a commit-ish capturing the exact worktree at session
 * start WITHOUT touching the working directory. `git stash create` builds
 * the commit object without storing it; falls back to HEAD when clean.
 * Returns null for non-repos.
 */
export async function createSessionBaseline(workspacePath: string): Promise<string | null> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: workspacePath, timeout: 10_000 })
  } catch {
    return null
  }
  const stashRef = (await git(workspacePath, ['stash', 'create'], true)).trim()
  if (stashRef) return stashRef
  const head = (await git(workspacePath, ['rev-parse', 'HEAD'], true)).trim()
  return head || null
}

/** Content of a file at the baseline; null when it didn't exist yet. */
export async function showFileAt(
  workspacePath: string,
  ref: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${relativePath}`], {
      cwd: workspacePath,
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  } catch {
    return null
  }
}

/** Restore one file to its baseline content (file-recovery UX). */
export async function restoreFileTo(
  workspacePath: string,
  ref: string,
  relativePath: string,
): Promise<{ restored: boolean; deleted: boolean }> {
  const baselineContent = await showFileAt(workspacePath, ref, relativePath)
  if (baselineContent === null) {
    // Didn't exist at baseline — the session created it; trash it.
    const { join } = await import('node:path')
    await shell.trashItem(join(workspacePath, relativePath))
    return { restored: false, deleted: true }
  }
  await git(workspacePath, ['checkout', ref, '--', relativePath])
  return { restored: true, deleted: false }
}
