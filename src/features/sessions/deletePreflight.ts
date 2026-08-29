import type { GhPullRequest, GitInfo, SessionMeta } from '@shared/models'

/**
 * What a bulk delete would do to one lane, and what should stop it.
 *
 * Two tiers, and the distinction matters more than the list:
 *
 * - A **blocker** refuses the delete outright. Only one thing qualifies: a
 *   turn in progress. Everything else is recoverable or the user's call.
 * - A **warning** is lost work the user may not know about. These do not
 *   refuse; they raise a single acknowledgement for the whole selection.
 *   One checkbox, not one per lane — a per-lane confirm trains you to click
 *   through it, which is how the guard stops working.
 *
 * Pure so the whole matrix is testable without a store or a modal, per the
 * repo's prefer-pure-logic rule.
 */
export interface LanePreflight {
  path: string
  title: string
  marker: string
  branch?: string
  worktreePath?: string
  mainRepoPath?: string
  /** Set when the lane cannot be deleted at all. */
  blocker?: 'running'
  /** Lost-work reasons; empty when the lane is clean. */
  warnings: Array<'uncommitted' | 'unpushed' | 'open-pr'>
  pr?: GhPullRequest
  dirtyCount: number
}

export interface PreflightSummary {
  lanes: LanePreflight[]
  /** Lanes that will actually be deleted. */
  deletable: LanePreflight[]
  /** Lanes refused, kept in the sidebar and reported afterwards. */
  blocked: LanePreflight[]
  /** Distinct warning reasons across the deletable set. */
  warnings: Array<'uncommitted' | 'unpushed' | 'open-pr'>
  /** True when the user must acknowledge before the delete is allowed. */
  needsAcknowledgement: boolean
  /** Deletable lanes that sit in their own worktree. */
  worktreeCount: number
}

export function classifyLane(input: {
  meta: SessionMeta
  title: string
  marker: string
  git?: GitInfo
  pr?: GhPullRequest
  isLive: boolean
  isStreaming: boolean
}): LanePreflight {
  const { meta, git, pr } = input
  const warnings: LanePreflight['warnings'] = []
  if (git?.dirtyCount) warnings.push('uncommitted')
  if (git?.ahead) warnings.push('unpushed')
  if (pr && (pr.state === 'OPEN' || pr.state === 'DRAFT')) warnings.push('open-pr')

  return {
    path: meta.path,
    title: input.title,
    marker: input.marker,
    branch: git?.branch,
    // Only a linked worktree has a directory of its own to remove. Deleting a
    // session that runs in the MAIN checkout must never offer to remove it.
    worktreePath: git?.isWorktree ? meta.cwd : undefined,
    mainRepoPath: git?.mainRepoPath,
    // Streaming is the refusal, not merely being live: an idle live session
    // is just a warm process, and disposing it is what delete already does.
    blocker: input.isStreaming ? 'running' : undefined,
    warnings,
    pr,
    dirtyCount: git?.dirtyCount ?? 0,
  }
}

export function summarizePreflight(lanes: LanePreflight[]): PreflightSummary {
  const deletable = lanes.filter((lane) => !lane.blocker)
  const blocked = lanes.filter((lane) => lane.blocker)
  const warnings = [...new Set(deletable.flatMap((lane) => lane.warnings))]
  return {
    lanes,
    deletable,
    blocked,
    warnings,
    needsAcknowledgement: warnings.length > 0,
    worktreeCount: deletable.filter((lane) => lane.worktreePath && lane.mainRepoPath).length,
  }
}

const WARNING_TEXT: Record<LanePreflight['warnings'][number], string> = {
  uncommitted: 'uncommitted changes',
  unpushed: 'unpushed commits',
  'open-pr': 'an open PR',
}

/** Human sentence for the acknowledgement, listing only what actually applies. */
export function describeWarnings(warnings: PreflightSummary['warnings']): string {
  return warnings.map((w) => WARNING_TEXT[w]).join(', ')
}
