import type { GitInfo, SessionMeta } from '@shared/models'
import { relativeTimeShort } from '@/lib/time'
import { formatCost } from '@/lib/format'

export interface SubtitleSegment {
  key: 'time' | 'worktree' | 'branch' | 'dirty' | 'cost'
  text: string
  /** The branch segment is the only one allowed to truncate. */
  truncate?: boolean
}

/**
 * Sidebar row subtitle: `2m · ⌥wt · ⎇ branch · ±3 · $1.24`.
 *
 * Everything after the timestamp is optional and data-driven; git segments
 * come from the batched per-cwd summary and may lag a refresh behind.
 */
export function sessionSubtitle(meta: SessionMeta, git: GitInfo | undefined): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [{ key: 'time', text: relativeTimeShort(meta.mtimeMs) }]
  if (git?.isRepo) {
    if (git.isWorktree) segments.push({ key: 'worktree', text: 'wt' })
    if (git.branch) segments.push({ key: 'branch', text: git.branch, truncate: true })
    if (git.dirtyCount) segments.push({ key: 'dirty', text: `±${git.dirtyCount}` })
  }
  if (meta.cost > 0) segments.push({ key: 'cost', text: formatCost(meta.cost) })
  return segments
}
