import { useState } from 'react'
import clsx from 'clsx'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { piCallOk } from '@/lib/rpc'
import { useChatStore } from '@/stores/chat'
import { LaneLadder } from './LaneLadder'
import {
  LANE_LOOP_STATUS_KEY,
  diffLabel,
  laneAction,
  laneHint,
  lanePrAction,
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
 * This is the mount point missing from every tool in this category: you open a
 * session and the software stops telling you where the work is. The transcript
 * is history; this is state.
 *
 * **It collapses, and it defaults to collapsed once the lane is green.** The
 * first version was a fixed three-row block that could not be dismissed, which
 * is the wrong trade twice over: it costs the transcript real estate on every
 * turn, and a permanent banner is exactly the always-on colour that ISA-101
 * warns leaves an alarm nowhere to go. Collapsed it is one line; expanded it
 * carries the ladder, the hint and the action.
 */
export function LaneBanner({
  sessionId,
  className,
}: {
  sessionId: string
  className?: string
}): React.JSX.Element | null {
  const loop = useLaneLoop(sessionId)
  // Undefined until the user decides, so the default can follow the lane's
  // state rather than freezing whatever it was on first render.
  const [override, setOverride] = useState<boolean | undefined>(undefined)
  const [sending, setSending] = useState(false)

  if (!loop) return null

  const action = laneAction(loop)
  const prAction = lanePrAction(loop)
  // A failed rung opens itself. A pending PR is already the final rung CTA.
  const open = override ?? action !== null
  const diff = diffLabel(loop)
  const over = overDiffBudget(loop)

  const send = async (nextAction: NonNullable<typeof action>): Promise<void> => {
    if (sending) return
    setSending(true)
    try {
      const ok = await piCallOk(sessionId, { type: 'prompt', message: nextAction.prompt })
      // Do not create a transcript entry for a command pi rejected.
      if (ok) useChatStore.getState().addUserMessage(sessionId, nextAction.prompt)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      data-testid="lane-banner"
      data-open={open ? 'true' : 'false'}
      className={clsx('border-border-strong bg-surface flex flex-col rounded-lg border', className)}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOverride(!open)}
          aria-expanded={open}
          aria-label={open ? 'Collapse lane status' : 'Expand lane status'}
          className="text-text-tertiary hover:text-text-secondary inline-flex min-w-0 items-center gap-2 text-left font-mono text-[10px] tracking-[0.08em] uppercase transition-colors"
        >
          <span aria-hidden className="text-[8px] leading-none">
            {open ? '▾' : '▸'}
          </span>
          {loop.branch ? (
            <span className="text-text-secondary truncate">⎇ {loop.branch}</span>
          ) : null}
          {diff ? <span className={over ? 'text-danger' : undefined}>{diff}</span> : null}
        </button>
        {/* Collapsed still answers "is anything wrong": the ladder remains visible,
            and the final stale PR rung is its own action. */}
        <LaneLadder
          loop={loop}
          className="ml-auto"
          onRungAction={prAction ? () => void send(prAction) : undefined}
        />
      </div>

      {open ? (
        <div className="border-border flex flex-col gap-2 border-t px-3 py-2">
          <p className="text-text-secondary text-sm leading-snug">{laneHint(loop)}</p>
          {action ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void send(action)}
                disabled={sending}
                title={action.prompt}
                className="border-accent text-accent bg-accent-soft hover:border-accent-hover shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors disabled:opacity-50"
              >
                {sending ? 'Sending…' : action.label}
              </button>
              <span className="text-text-tertiary font-mono text-[10px]">
                starts a turn in this lane
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
