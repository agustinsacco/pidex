import clsx from 'clsx'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { LaneLadder } from './LaneLadder'
import {
  LANE_LOOP_STATUS_KEY,
  diffLabel,
  laneHint,
  overDiffBudget,
  parseLaneLoop,
} from './laneLoop'
import type { LaneLoop } from '@shared/models'

/**
 * Read one lane's loop out of the extension-UI status map.
 *
 * Same wire contract as the context meter: JSON in a string on a status key,
 * parsed defensively, and a missing key renders nothing rather than an empty
 * section. Shared by both mount points so they can never disagree.
 */
export function useLaneLoop(sessionId: string | null): LaneLoop | null {
  const status = useExtensionUiStore((s) =>
    sessionId ? s.statuses[sessionId]?.[LANE_LOOP_STATUS_KEY] : undefined,
  )
  return parseLaneLoop(status)
}

/**
 * The lane loop, above the composer.
 *
 * This is the mount point that is missing from every tool in this category.
 * You open a session and the software stops telling you where the work is:
 * the transcript is history, and there is no state. So the ladder sits where
 * you are actually standing when you decide what to type next, along with one
 * mechanically generated line naming what has to be true before this lane can
 * open its pull request.
 *
 * No model runs to produce any of it, which is what lets it be permanent.
 */
export function LaneBanner({
  sessionId,
  className,
}: {
  sessionId: string
  className?: string
}): React.JSX.Element | null {
  const loop = useLaneLoop(sessionId)
  if (!loop) return null

  const diff = diffLabel(loop)
  const over = overDiffBudget(loop)

  return (
    <div
      data-testid="lane-banner"
      className={clsx(
        'border-border-strong bg-surface flex flex-col gap-2 rounded-lg border px-3 py-2',
        className,
      )}
    >
      <div className="text-text-tertiary flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.08em] uppercase">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {loop.branch ? <span className="text-text-secondary">⎇ {loop.branch}</span> : null}
          {diff ? <span className={over ? 'text-danger' : undefined}>{diff}</span> : null}
        </span>
        {over && loop.diffBudget ? (
          <span className="text-danger">over the {loop.diffBudget.lines}-line review budget</span>
        ) : null}
      </div>

      <LaneLadder loop={loop} />

      <p className="text-text-secondary text-sm leading-snug">{laneHint(loop)}</p>
    </div>
  )
}
