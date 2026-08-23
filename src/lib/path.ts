/**
 * Path helpers for display. These operate on the POSIX-and-Windows mix of
 * separators that reaches the renderer, so they split on both.
 */

const SEPARATORS = /[/\\]/

/** Last path segment: `src/lib/a.ts` → `a.ts`. Falls back to the input. */
export function basename(path: string): string {
  const parts = path.split(SEPARATORS)
  return parts[parts.length - 1] || path
}

/** Everything before the last separator: `src/lib/a.ts` → `src/lib`. */
export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '' : path.slice(0, index)
}

/** Split into directory and basename in one pass, for two-tone list rows. */
export function splitPath(path: string): { dir: string; base: string } {
  return { dir: dirname(path), base: basename(path) }
}

/**
 * Display name for a workspace folder. Trailing separators are ignored, so
 * `/home/u/proj/` and `/home/u/proj` both yield `proj`.
 */
export function workspaceName(workspacePath: string): string {
  return workspacePath.split(SEPARATORS).filter(Boolean).pop() ?? workspacePath
}

/**
 * True for a path inside a repo's internal worktree folder
 * (`<repo>/.pidex/worktrees/<name>`).
 *
 * A worktree is a *branch* of an existing workspace, not a workspace of its
 * own, so it must never be persisted as one — otherwise the sidebar and the
 * workspace switcher fill with a header per chat instead of one header per
 * project.
 */
export function isWorktreeFolder(path: string): boolean {
  return /[/\\]\.pidex[/\\]worktrees[/\\]/.test(path)
}

/**
 * Display name that understands linked worktrees: `repoName (branch)` rather
 * than the worktree folder's own basename. Worktree folders are commonly
 * named after their branch (`.../worktrees/main`), which made the sidebar and
 * window title show "main" for what is actually the `pidex` repo.
 */
export function worktreeAwareName(
  workspacePath: string,
  git?: { isWorktree?: boolean; mainRepoPath?: string; branch?: string },
): string {
  if (git?.isWorktree && git.mainRepoPath) {
    const repo = workspaceName(git.mainRepoPath)
    return git.branch ? `${repo} (${git.branch})` : repo
  }
  return workspaceName(workspacePath)
}
