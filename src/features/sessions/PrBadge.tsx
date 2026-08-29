import clsx from 'clsx'
import type { GhPullRequest } from '@shared/models'
import { prChip, type PrChipVariant } from './prChip'

/**
 * Per-variant colours. `soft` grounds plus a tinted border, so the chip stays
 * legible on all three row grounds (sidebar, hover, active) without a fill
 * strong enough to compete with the lane title.
 */
const VARIANTS: Record<PrChipVariant, string> = {
  open: 'text-success bg-success/10 border-success/25',
  approved: 'text-success bg-success/10 border-success/25',
  failing: 'text-danger bg-danger-soft border-danger/30',
  pending: 'text-warning bg-warning/10 border-warning/25',
  blocked: 'text-warning bg-warning/10 border-warning/25',
  draft: 'text-text-tertiary bg-chip border-transparent',
  merged: 'text-merged bg-merged-soft border-merged/25',
  closed: 'text-danger bg-danger-soft border-danger/25',
}

/**
 * The PR chip on a lane row.
 *
 * Right-aligned (`ml-auto`) on purpose: down a sidebar the chips form a
 * scannable column instead of floating after a branch name whose width varies
 * per lane. `shrink-0` keeps it whole — the branch segment is the one allowed
 * to truncate.
 */
export function PrBadge({ pr }: { pr: GhPullRequest }): React.JSX.Element {
  const chip = prChip(pr)
  return (
    <span
      data-testid="session-pr-badge"
      data-variant={chip.variant}
      title={chip.title}
      className={clsx(
        'ml-auto flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 font-mono text-2xs font-semibold',
        VARIANTS[chip.variant],
      )}
    >
      {chip.label}
      {chip.glyph && <span aria-hidden>{chip.glyph}</span>}
    </span>
  )
}
