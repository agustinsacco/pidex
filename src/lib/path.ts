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
