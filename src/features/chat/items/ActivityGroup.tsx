import { memo, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ToolState } from '../reducer'
import {
  externalToolInfo,
  isActivityLive,
  summarizeActivity,
  type ActivityStep,
} from './transcriptRows'
import { ToolCard, ToolDetail } from '../tools/ToolCard'
import { settledVerb } from '../tools/toolSummaries'
import { Markdown } from '@/components/markdown/Markdown'
import { ChevronIcon } from '@/components/icons'
import { useChatUiStore } from '../uiState'

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
 *
 * The group is *title-anchored*: the summary text, the card's left edge and
 * the prose above it all start at the same x. Everything that indents does so
 * INSIDE the card. Before this, the card overhung the summary text by 6px on
 * the left while the rows sat 6px further right than it — three different
 * left edges in one unit, which is what made it read as loose.
 */

/**
 * Left inset shared by every row inside the card — tool rows, CLI-side tool
 * rows, sub-agent launches, reasoning-only rows. One constant because the
 * moment two of them disagree the card stops reading as a single column, and
 * Claude-provider sessions mix all four shapes in one run.
 *
 * 16px also happens to be the width the reasoning mark needs, so the mark
 * floats in this inset instead of reserving a column in rows that have no
 * reasoning to show.
 */
export const ROW_INSET = 'pl-4 pr-2'
export const ActivityGroup = memo(function ActivityGroup({
  steps,
  tools,
  hideThinking,
  sessionId,
  active,
}: {
  steps: ActivityStep[]
  tools: Record<string, ToolState>
  hideThinking: boolean
  sessionId: string
  /** The agent is still in this activity run, including gaps between tools. */
  active: boolean
}): React.JSX.Element | null {
  /** null = follow the live/settled default; true/false = explicit user choice. */
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const verbose = useChatUiStore((s) => s.verbose[sessionId] ?? false)
  const live = isActivityLive(steps, tools)
  const activeRun = active || live

  // Reset the override when a group becomes active again (a settled group the
  // user collapsed should still open itself if new work lands in it). Unlike
  // individual tool liveness, `active` spans the quiet hand-off between one
  // completed tool and the next assistant message.
  const wasActive = useRef(activeRun)
  useEffect(() => {
    if (activeRun && !wasActive.current) setUserOpen(null)
    wasActive.current = activeRun
  }, [activeRun])

  // ⌃O flips the session's default open/closed state (uiState.verbose). Drop
  // per-group overrides when it changes, or "expand everything" would skip
  // exactly the groups the user had collapsed by hand.
  useEffect(() => {
    setUserOpen(null)
  }, [verbose])

  const visible = hideThinking ? steps.filter((s) => s.block.type !== 'thinking') : steps
  if (visible.length === 0) return null

  const open = activeRun || (userOpen ?? verbose)
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

  const liveLabel = [
    summary.stepLabel,
    summary.detail,
    summary.thinkingCount > 0
      ? `${summary.thinkingCount} thought${summary.thinkingCount === 1 ? '' : 's'}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    // The frame moved off this wrapper on purpose: the summary line is plain
    // prose-adjacent text (caret + label), and only the step list below gets
    // a bordered card. Boxing the whole run made the summary read as part of
    // the tool output instead of the narration above it.
    <div data-testid="activity-group" data-live={activeRun || undefined}>
      <button
        data-testid="activity-summary"
        onClick={() => {
          if (!activeRun) setUserOpen(!open)
        }}
        aria-expanded={open}
        /*
         * Padding pulled back out with a negative margin so the label starts
         * at x=0 — flush with the prose above and the card below — while the
         * hover surface still has room to breathe around the text.
         */
        className="hover:bg-bg-secondary/60 -ml-1.5 flex w-[calc(100%+0.375rem)] items-center rounded-md px-1.5 py-0.5 text-left transition-colors"
      >
        {activeRun ? (
          // One flat span while live: the shimmer clips a gradient to the
          // text, which needs a single run of same-colored glyphs.
          <span className="thinking-shimmer min-w-0 truncate text-base">{liveLabel}</span>
        ) : (
          <span className="text-text-secondary min-w-0 truncate text-base">
            <span className="text-text font-medium">{summary.stepLabel}</span>
            {summary.detail && ` · ${summary.detail}`}
            {summary.thinkingCount > 0 && (
              <span className="text-text-tertiary">
                {' · '}
                {summary.thinkingCount} thought{summary.thinkingCount === 1 ? '' : 's'}
              </span>
            )}
          </span>
        )}
        {/*
         * The status slot TRAILS the label, and the live dot and the settled
         * caret share it. Leading them would move the label 14px sideways at
         * the moment a run settles — the one moment the eye is already on it.
         */}
        {activeRun ? (
          <span
            aria-hidden
            className="bg-accent tool-running-dot ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          />
        ) : (
          <ChevronIcon
            expanded={open}
            size={9}
            strokeWidth={3}
            className="text-text-tertiary ml-1.5"
          />
        )}
        {summary.failedCount > 0 && (
          <span className="bg-danger-soft text-danger ml-auto shrink-0 rounded px-1.5 py-px text-xs font-medium">
            {summary.failedCount} failed
          </span>
        )}
      </button>

      <div
        aria-hidden={!open}
        inert={!open}
        className={clsx('activity-group-body', open && 'activity-group-body-open')}
      >
        {/* overflow-hidden moved here from the old outer frame — the grid
            track collapse needs a clipping child to actually hide the card. */}
        <div className="min-h-0 overflow-hidden">
          {/*
           * Border only, no fill. A white card on the grey page plus a border
           * is two containment signals for one group; the hairline alone is
           * enough and keeps the run visually subordinate to the prose.
           * `rounded-lg` is 14px in this theme (--px-radius-lg), which was far
           * too round for a 26px row — hence the explicit 7.
           */}
          <div className="border-border divide-border/50 mt-1 divide-y overflow-hidden rounded-[7px] border">
            {rows.map(({ step, thought }) => (
              <div
                className="activity-step-enter"
                key={step.block.type === 'tool' ? step.block.toolCallId : `th-${step.block.index}`}
              >
                <ActivityRow step={step} thought={thought} tools={tools} sessionId={sessionId} />
              </div>
            ))}
            {trailingThought && <ThoughtOnlyRow text={trailingThought} />}
          </div>
        </div>
      </div>
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
  const [expanded, setExpanded] = useState(false)

  // Tools Claude Code ran inside its own process while acting as the model
  // provider. There is no pi tool result to show — only what was invoked —
  // so this is a compact, always-settled row rather than a ToolCard.
  if (step.block.type === 'externalTool') {
    const { name, args } = step.block
    const info = externalToolInfo(name, args)
    if (info.isAgent) {
      return <SubagentRow headline={info.headline} detail={info.detail} />
    }
    return (
      // Typed like a ToolCard row on purpose (same inset, same text-lg, same
      // secondary/primary split): a Claude-provider run interleaves these with
      // real pi tool calls, and a second type scale made the same run look
      // like two different transcripts stitched together.
      <div
        className={clsx('flex items-center gap-1.5 py-1 text-lg', ROW_INSET)}
        data-testid="external-tool-row"
      >
        <span className="text-text-tertiary shrink-0">Claude Code</span>
        <span className="text-text shrink-0 font-medium">{name}</span>
        {info.headline && (
          <span className="text-text-secondary min-w-0 truncate" title={args && `${name} ${args}`}>
            {info.headline}
          </span>
        )}
      </div>
    )
  }

  if (step.block.type !== 'tool') return null
  const tool = tools[step.block.toolCallId]
  if (!tool) return null

  const showThought = thought && (pinned || hovered)

  return (
    <div>
      {/* The mark floats in the row's own inset rather than reserving a column
          in front of every row. Reserving it pushed all four row types 20px
          right of the card edge for the sake of the few that have reasoning. */}
      <div className={clsx('relative', ROW_INSET)}>
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
              'absolute left-px top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded text-2xs transition-colors',
              pinned
                ? 'bg-accent-soft text-accent'
                : 'text-text-tertiary hover:bg-accent-soft hover:text-accent',
            )}
          >
            ✳
          </button>
        )}
        <ToolCard
          tool={tool}
          sessionId={sessionId}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
        />
      </div>
      {expanded && (
        // Not a second card: the detail is a full-width section of the
        // group's card, divided from the row above. A nested bordered box
        // here read as box-in-a-box.
        <div className="border-border expand-enter border-t">
          <ToolDetail tool={tool} sessionId={sessionId} />
        </div>
      )}
      {showThought && (
        <div
          data-testid="thought-body"
          className="border-border text-text-secondary mb-1.5 ml-4 mr-2 border-l-2 pl-2.5 text-base italic opacity-90 [&_.md-content]:text-base"
        >
          <Markdown text={thought} />
        </div>
      )}
    </div>
  )
}

/**
 * A Claude Code sub-agent launch (`Agent`/`Task` marker).
 *
 * Rendered as its own labeled step — an agent spinning up is the headline of
 * a turn, not an anonymous tool. Only the invocation is knowable: the
 * provider neither streams the agent's transcript nor keeps the CLI alive
 * past the turn (specs/reference/extensions.md), so this row makes no claims about
 * progress or completion. The prompt expands on click when it survived the
 * provider's argument-preview cap.
 */
function SubagentRow({
  headline,
  detail,
}: {
  headline?: string
  detail?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const expandable = Boolean(detail)
  return (
    <div data-testid="subagent-row">
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className={clsx(
          'flex w-full items-center gap-1.5 py-1 text-left text-lg transition-colors',
          ROW_INSET,
          expandable && 'hover:bg-bg-secondary/60',
        )}
      >
        <span className="bg-accent-soft text-accent shrink-0 rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide">
          agent
        </span>
        <span className="text-text min-w-0 truncate font-medium">
          {headline ?? 'Sub-agent task'}
        </span>
        {expandable && (
          <ChevronIcon expanded={open} size={9} strokeWidth={3} className="text-text-tertiary" />
        )}
      </button>
      {open && detail && (
        <div
          data-testid="subagent-prompt"
          className="border-accent/30 text-text-secondary mb-1.5 ml-4 mr-2 whitespace-pre-wrap border-l-2 pl-2.5 text-sm"
        >
          {detail}
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
        className="text-text-tertiary hover:text-text-secondary relative flex w-full items-center py-1 pl-4 pr-2 text-left text-base italic transition-colors"
      >
        {/* Same column the paired mark floats in, so a reasoning-only row and
            a tool row with reasoning put their ✳ in exactly one place. */}
        <span className="text-2xs absolute left-px flex w-3.5 justify-center">✳</span>
        <span>Reasoning</span>
      </button>
      {open && (
        <div
          data-testid="thought-body"
          className="border-border text-text-secondary mb-1.5 ml-4 mr-2 border-l-2 pl-2.5 text-base italic opacity-90 [&_.md-content]:text-base"
        >
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}
