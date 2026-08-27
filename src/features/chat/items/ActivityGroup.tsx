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
 */
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
        className="hover:bg-bg-secondary/60 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors"
      >
        {activeRun ? (
          <span
            aria-hidden
            className="bg-accent tool-running-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
        ) : (
          <ChevronIcon expanded={open} size={9} strokeWidth={3} className="text-text-tertiary" />
        )}
        {activeRun ? (
          // One flat span while live: the shimmer clips a gradient to the
          // text, which needs a single run of same-colored glyphs.
          <span className="thinking-shimmer min-w-0 flex-1 truncate text-base">{liveLabel}</span>
        ) : (
          <span className="text-text-secondary min-w-0 flex-1 truncate text-base">
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
        {summary.failedCount > 0 && (
          <span className="bg-danger-soft text-danger shrink-0 rounded px-1.5 py-px text-xs font-medium">
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
          <div className="border-border bg-surface divide-border/50 mt-1 divide-y overflow-hidden rounded-lg border">
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
      <div className="flex items-start px-2" data-testid="external-tool-row">
        <span className="flex w-5 shrink-0 justify-center pt-1" />
        <span
          className="text-text-secondary min-w-0 flex-1 truncate text-base"
          title={args && `${name} ${args}`}
        >
          <span className="text-text-tertiary">Claude Code</span>{' '}
          <span className="text-text">{name}</span>
          {info.headline && <span className="text-text-tertiary ml-1.5">{info.headline}</span>}
        </span>
      </div>
    )
  }

  if (step.block.type !== 'tool') return null
  const tool = tools[step.block.toolCallId]
  if (!tool) return null

  const showThought = thought && (pinned || hovered)

  return (
    <div>
      <div className="flex items-start px-2">
        <span className="flex w-5 shrink-0 justify-center pt-1">
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
                'flex h-4 w-4 items-center justify-center rounded text-2xs transition-colors',
                pinned
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-tertiary hover:bg-accent-soft hover:text-accent',
              )}
            >
              ✳
            </button>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <ToolCard
            tool={tool}
            sessionId={sessionId}
            expanded={expanded}
            onToggle={() => setExpanded((e) => !e)}
          />
        </span>
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
          className="border-border text-text-secondary mb-1.5 ml-7 mr-2 border-l-2 pl-2.5 text-base italic opacity-90 [&_.md-content]:text-base"
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
 * past the turn (specs/12-extensions.md), so this row makes no claims about
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
          'flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors',
          expandable && 'hover:bg-bg-secondary/60',
        )}
      >
        <span className="bg-accent-soft text-accent shrink-0 rounded px-1.5 py-px text-xs font-semibold uppercase tracking-wide">
          agent
        </span>
        <span className="text-text min-w-0 flex-1 truncate text-base">
          {headline ?? 'Sub-agent task'}
        </span>
        {expandable && (
          <ChevronIcon expanded={open} size={9} strokeWidth={3} className="text-text-tertiary" />
        )}
      </button>
      {open && detail && (
        <div
          data-testid="subagent-prompt"
          className="border-accent/30 text-text-secondary mb-1.5 ml-2 mr-2 whitespace-pre-wrap border-l-2 pl-2.5 text-sm"
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
        className="text-text-tertiary hover:text-text-secondary flex w-full items-center gap-1.5 px-2 py-1 text-left text-base italic transition-colors"
      >
        <span className="text-2xs flex w-5 justify-center">✳</span>
        <span>Reasoning</span>
      </button>
      {open && (
        <div
          data-testid="thought-body"
          className="border-border text-text-secondary mb-1.5 ml-7 mr-2 border-l-2 pl-2.5 text-base italic opacity-90 [&_.md-content]:text-base"
        >
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}
