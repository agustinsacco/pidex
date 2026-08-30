import type { GitInfo } from '@shared/models'
import { relativeTimeShort } from '@/lib/time'
import { formatCost } from '@/lib/format'

export interface SubtitleSegment {
  key: 'time' | 'worktree' | 'branch' | 'dirty' | 'cost'
  text: string
  /** The branch segment is the only one allowed to truncate. */
  truncate?: boolean
}

/**
 * The two fields a subtitle needs, rather than a whole `SessionMeta`.
 *
 * A live session with no file on disk yet has no `SessionMeta` at all, and it
 * needs this same subtitle — pi does not write a session file until a turn
 * ends, so that row is on screen for the length of the first turn.
 */
export interface SubtitleSource {
  mtimeMs: number
  cost: number
}

/**
 * Sidebar row subtitle: `2m · ⌥wt · ⎇ branch · ±3 · $1.24`.
 *
 * Everything after the timestamp is optional and data-driven; git segments
 * come from the batched per-cwd summary and may lag a refresh behind.
 *
 * `showCost` defaults on. The sidebar passes `false` when `LanePrefs.prStatus`
 * is on, so the row's PR chip (`prChip.ts` + `PrBadge.tsx`) replaces cost
 * instead of trailing it — the two are not meant to coexist, or the row reads
 * as double-counted status.
 */
export function sessionSubtitle(
  meta: SubtitleSource,
  git: GitInfo | undefined,
  opts: { showCost?: boolean } = {},
): SubtitleSegment[] {
  const showCost = opts.showCost ?? true
  const segments: SubtitleSegment[] = [{ key: 'time', text: relativeTimeShort(meta.mtimeMs) }]
  if (git?.isRepo) {
    if (git.isWorktree) segments.push({ key: 'worktree', text: 'wt' })
    if (git.branch) segments.push({ key: 'branch', text: git.branch, truncate: true })
    if (git.dirtyCount) segments.push({ key: 'dirty', text: `±${git.dirtyCount}` })
  }
  if (showCost && meta.cost > 0) segments.push({ key: 'cost', text: formatCost(meta.cost) })
  return segments
}
