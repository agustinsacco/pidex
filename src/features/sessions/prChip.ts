import type { GhPullRequest } from '@shared/models'

/**
 * The sidebar's PR chip: one token carrying two signals.
 *
 * A lane row's second line already holds time, `wt`, branch, dirty count and
 * cost. A separate CI chip would double the ink on the densest line in the app
 * and truncate the branch to nothing — and the two are read together anyway
 * ("is it in, and is it green"). So the VARIANT (colour) is the PR state and
 * the GLYPH is the check/review verdict.
 */
export type PrChipVariant =
  | 'open' // open, checks green
  | 'approved' // open, green, and a human approved
  | 'failing' // checks red — the only state that earns colour at rest
  | 'pending' // checks still running
  | 'blocked' // green, but changes requested: blocked on a person, not a build
  | 'draft'
  | 'merged'
  | 'closed'

export interface PrChip {
  variant: PrChipVariant
  /** `#412` */
  label: string
  /** Trailing verdict glyph; empty when the state already says everything. */
  glyph: string
  /** Tooltip / aria description. */
  title: string
}

function checkPhase(pr: GhPullRequest): 'pass' | 'fail' | 'pending' | 'none' {
  const checks = pr.checks
  if (!checks || checks.total === 0) return 'none'
  if (checks.failed > 0) return 'fail'
  if (checks.pending > 0) return 'pending'
  return 'pass'
}

function describeChecks(pr: GhPullRequest): string {
  const checks = pr.checks
  if (!checks || checks.total === 0) return 'no checks'
  const parts: string[] = []
  if (checks.passed) parts.push(`${checks.passed} passed`)
  if (checks.failed) parts.push(`${checks.failed} failed`)
  if (checks.pending) parts.push(`${checks.pending} running`)
  return parts.join(', ')
}

/**
 * Terminal states win over check state: a merged PR whose last run happened to
 * be red is still merged, and rendering it red would send you to fix a branch
 * that is already in.
 */
export function prChip(pr: GhPullRequest): PrChip {
  const label = `#${pr.number}`
  const base = `${label} ${pr.title}`.trim()

  if (pr.state === 'MERGED') {
    return { variant: 'merged', label, glyph: '', title: `${base} — merged` }
  }
  if (pr.state === 'CLOSED') {
    return { variant: 'closed', label, glyph: '', title: `${base} — closed unmerged` }
  }

  const phase = checkPhase(pr)
  const checks = describeChecks(pr)

  if (pr.state === 'DRAFT') {
    return {
      variant: phase === 'fail' ? 'failing' : 'draft',
      label,
      glyph: phase === 'fail' ? '✕' : phase === 'pending' ? '◔' : '',
      title: `${base} — draft, ${checks}`,
    }
  }

  if (phase === 'fail') {
    return { variant: 'failing', label, glyph: '✕', title: `${base} — open, ${checks}` }
  }
  if (phase === 'pending') {
    return { variant: 'pending', label, glyph: '◔', title: `${base} — open, ${checks}` }
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return {
      variant: 'blocked',
      label,
      glyph: '±',
      title: `${base} — open, ${checks}, changes requested`,
    }
  }
  if (pr.reviewDecision === 'APPROVED') {
    return { variant: 'approved', label, glyph: '✓✓', title: `${base} — open, ${checks}, approved` }
  }
  return { variant: 'open', label, glyph: '✓', title: `${base} — open, ${checks}` }
}
