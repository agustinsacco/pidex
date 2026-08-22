import { shell } from 'electron'
import { git } from './git-exec'

/** Per-file porcelain status for explorer dots: relativePath → XY code. */
export async function gitStatusMap(workspacePath: string): Promise<Record<string, string>> {
  const out = await git(workspacePath, ['status', '--porcelain', '-uall'], { allowFail: true })
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
    await git(workspacePath, ['rev-parse', '--git-dir'])
  } catch {
    return null
  }
  const stashRef = await git(workspacePath, ['stash', 'create'], { allowFail: true, trim: true })
  if (stashRef) return stashRef
  const head = await git(workspacePath, ['rev-parse', 'HEAD'], { allowFail: true, trim: true })
  return head || null
}

/** Content of a file at the baseline; null when it didn't exist yet. */
export async function showFileAt(
  workspacePath: string,
  ref: string,
  relativePath: string,
): Promise<string | null> {
  try {
    // Not `allowFail`: '' is a legitimate file content, and `restoreFileTo`
    // treats null as "did not exist at baseline" and trashes the file.
    return await git(workspacePath, ['show', `${ref}:${relativePath}`])
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
