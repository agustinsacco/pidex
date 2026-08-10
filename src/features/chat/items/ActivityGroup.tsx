import { memo, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ToolState } from '../reducer'
import { isActivityLive, summarizeActivity, type ActivityStep } from './transcriptRows'
import { ToolCard } from '../tools/ToolCard'
import { settledVerb } from '../tools/toolSummaries'
import { Markdown } from '@/components/markdown/Markdown'
import { ChevronIcon } from '@/components/icons'

/**
 * One run of agent activity — thinking and tool calls, merged across pi's
 * message boundaries by `buildTranscriptRows`.
 *
 * Three behaviors, from the design review:
 *
 * - **Spine (A)**: the whole run is one framed unit with a collapsed head
 *   ("9 steps · edited 5 files, ran 2 commands"), so a 22-tool turn reads as
 *   four scannable lines instead of 22 spaced rows.
 * - **Gutter thinking (B)**: thinking never occupies a row of its own. It
 *   becomes a small mark in the left gutter of the step it preceded; hover or
 *   focus previews it, click pins it open. Zero vertical cost until asked for.
 * - **Live vs settled (D)**: while anything is running the group is open and
 *   accented so you can watch work happen; once it settles it auto-collapses
 *   to the summary line — unless the user opened it themselves, which always
 *   wins.
 */
export const ActivityGroup = memo(function ActivityGroup({
  steps,
  tools,
  hideThinking,
  sessionId,
}: {
  steps: ActivityStep[]
  tools: Record<string, ToolState>
  hideThinking: boolean
  sessionId: string
}): React.JSX.Element | null {
  /** null = follow the live/settled default; true/false = explicit user choice. */
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const live = isActivityLive(steps, tools)

  // Reset the override when a group goes live again (a settled group the user
  // collapsed should still open itself if new work lands in it).
  const wasLive = useRef(live)
  useEffect(() => {
    if (live && !wasLive.current) setUserOpen(null)
    wasLive.current = live
  }, [live])

  const visible = hideThinking ? steps.filter((s) => s.block.type !== 'thinking') : steps
  if (visible.length === 0) return null

  const open = userOpen ?? live
  const summary = summarizeActivity(visible, tools, (t) => settledVerb(t.toolName ?? ''))

  // Pair each thinking block onto the step that follows it (gutter mark);
  // trailing thinking with nothing after it keeps its own minimal row.
  const rows: Array<{ step: ActivityStep; thought?: string }> = []
  let pendingThought: string | undefined
  for (const step of visible) {
    if (step.block.type === 'thinking') {
      pendingThought = pendingThought ? `${pendingThought}\n\n${step.block.text}` : step.block.text
      continue
    }
    rows.push({ step, thought: pendingThought })
    pendingThought = undefined
  }
  const trailingThought = pendingThought

  return (
    <div
      data-testid="activity-group"
      data-live={live || undefined}
      className={clsx(
        'overflow-hidden rounded-lg border transition-colors',
        live ? 'border-accent/45 bg-surface' : 'border-border bg-surface',
      )}
    >
      <button
        data-testid="activity-summary"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="hover:bg-bg-secondary flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
      >
        {live ? (
          <span
            aria-hidden
            className="bg-accent tool-running-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
        ) : (
          <ChevronIcon expanded={open} size={9} strokeWidth={3} className="text-text-tertiary" />
        )}
        <span className="text-text-secondary min-w-0 flex-1 truncate text-[12.5px]">
          <span className="text-text font-medium">{summary.stepLabel}</span>
          {summary.detail && ` · ${summary.detail}`}
          {summary.thinkingCount > 0 && (
            <span className="text-text-tertiary">
              {' · '}
              {summary.thinkingCount} thought{summary.thinkingCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {summary.failedCount > 0 && (
          <span className="bg-danger-soft text-danger shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium">
            {summary.failedCount} failed
          </span>
        )}
      </button>

      {open && (
        <div className="border-border divide-border/50 divide-y border-t">
          {rows.map(({ step, thought }) => (
            <ActivityRow
              key={step.block.type === 'tool' ? step.block.toolCallId : `th-${step.block.index}`}
              step={step}
              thought={thought}
              tools={tools}
              sessionId={sessionId}
            />
          ))}
          {trailingThought && <ThoughtOnlyRow text={trailingThought} />}
        </div>
      )}
    </div>
  )
})

/** A tool step, with any preceding reasoning available from the gutter. */
function ActivityRow({
  step,
  thought,
  tools,
  sessionId,
}: {
  step: ActivityStep
  thought?: string
  tools: Record<string, ToolState>
  sessionId: string
}): React.JSX.Element | null {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  if (step.block.type !== 'tool') return null
  const tool = tools[step.block.toolCallId]
  if (!tool) return null

  const showThought = thought && (pinned || hovered)

  return (
    <div>
      <div className="flex items-start">
        <span className="flex w-6 shrink-0 justify-center pt-1">
          {thought && (
            <button
              onClick={() => setPinned((p) => !p)}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
              title="Reasoning before this step"
              aria-label="Show reasoning before this step"
              aria-expanded={pinned}
              data-testid="thought-mark"
              className={clsx(
                'flex h-4 w-4 items-center justify-center rounded text-[9px] transition-colors',
                pinned
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-tertiary hover:bg-accent-soft hover:text-accent',
              )}
            >
              ✳
            </button>
          )}
        </span>
        <span className="min-w-0 flex-1 pr-2">
          <ToolCard tool={tool} sessionId={sessionId} />
        </span>
      </div>
      {showThought && (
        <div
          data-testid="thought-body"
          className="border-border text-text-secondary mb-1.5 ml-6 mr-2 border-l-2 pl-2.5 text-[12.5px] italic opacity-90 [&_.md-content]:text-[12.5px]"
        >
          <Markdown text={thought} />
        </div>
      )}
    </div>
  )
}

/** Reasoning with no tool call after it (e.g. the turn ended on a thought). */
function ThoughtOnlyRow({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="thought-mark"
        className="text-text-tertiary hover:text-text-secondary flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px] italic transition-colors"
      >
        <span className="text-[9px]">✳</span>
        <span>Reasoning</span>
      </button>
      {open && (
        <div
          data-testid="thought-body"
          className="border-border text-text-secondary mb-1.5 ml-6 mr-2 border-l-2 pl-2.5 text-[12.5px] italic opacity-90 [&_.md-content]:text-[12.5px]"
        >
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}
