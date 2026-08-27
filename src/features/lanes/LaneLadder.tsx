import clsx from 'clsx'
import type { LaneLoop, LaneRung } from '@shared/models'
import { currentRung } from './laneLoop'

/**
 * The lane loop, rendered.
 *
 * ONE component, two mount points: the right-hand end of a lane row on the
 * fleet surface, and directly above the composer inside the lane. That is
 * deliberate — the ladder is the lane's state, and the state should not change
 * shape depending on where you happen to be standing.
 *
 * Colour discipline is ISA-101: grey for normal, saturated colour reserved for
 * abnormal. A lane where everything passes reads as a row of quiet grey ticks,
 * so the one amber or red rung on a screen of ten lanes is the only thing your
 * eye lands on. If normal operation is colourful, an alarm has nowhere to go.
 *
 * Order is fixed and never sorted by state. A ladder whose rungs move is one
 * you have to read; a ladder that never moves is one you can glance at.
 */

const STATE_CLASS: Record<LaneRung['state'], string> = {
  // Passed: filled, but still grey. A green wall trains you to stop looking.
  pass: 'border-border-strong text-text-secondary [&>i]:bg-text-tertiary [&>i]:border-text-tertiary',
  // Not run since the last edit. The honest default, and visually the weakest.
  stale: 'border-border text-text-tertiary [&>i]:border-border-strong',
  // The one that needs a person.
  fail: 'border-danger text-danger bg-danger-soft [&>i]:bg-danger [&>i]:border-danger z-[1]',
  running: 'border-accent text-accent bg-accent-soft [&>i]:bg-accent [&>i]:border-accent z-[1]',
  // No command for this rung in this project: present, so the ladder keeps its
  // shape, but explicitly not a claim about anything.
  unconfigured: 'border-border text-text-tertiary opacity-50 [&>i]:border-border',
}

export function LaneLadder({
  loop,
  className,
}: {
  loop: LaneLoop
  className?: string
}): React.JSX.Element {
  const here = currentRung(loop)
  return (
    <div
      data-testid="lane-ladder"
      className={clsx('flex flex-wrap items-center font-mono text-[10px]', className)}
    >
      {loop.rungs.map((rung, index) => {
        const isHere = here?.key === rung.key && rung.state !== 'fail'
        return (
          <span
            key={rung.key}
            data-rung={rung.key}
            data-state={rung.state}
            title={rungTitle(rung)}
            className={clsx(
              'inline-flex items-center gap-1.5 whitespace-nowrap border border-r-0 px-1.5 py-0.5',
              'font-semibold uppercase tracking-[0.07em]',
              index === 0 && 'rounded-l-[5px]',
              index === loop.rungs.length - 1 && 'rounded-r-[5px] border-r',
              isHere && rung.state === 'stale'
                ? 'border-accent text-accent bg-accent-soft z-[1] [&>i]:border-accent [&>i]:bg-accent'
                : STATE_CLASS[rung.state],
            )}
          >
            <i className="inline-block h-[5px] w-[5px] rounded-full border" />
            {rung.label}
          </span>
        )
      })}
    </div>
  )
}

/**
 * The tooltip is the exemplar: every rung says exactly what ran and what it
 * exited with, so a pass is checkable rather than merely asserted.
 */
function rungTitle(rung: LaneRung): string {
  if (rung.state === 'unconfigured') return `${rung.label}: no command configured for this project`
  if (rung.state === 'stale') return `${rung.label}: has not run since the last edit`
  if (rung.state === 'running') return `${rung.label}: running now`
  const parts = [rung.command ?? rung.label]
  if (rung.exitCode !== undefined) parts.push(`exit ${rung.exitCode}`)
  if (rung.durationMs !== undefined) parts.push(`${Math.round(rung.durationMs / 100) / 10}s`)
  if (rung.detail) parts.push(rung.detail)
  return parts.join(' · ')
}
