import type { AssistantBlock, AssistantItem, ChatItem, ToolState } from '../reducer'

/**
 * Turn-level transcript grouping.
 *
 * pi emits ONE assistant message per tool call (verified across 356 real
 * assistant messages: 302 carried exactly one). Grouping inside a single
 * message therefore can never collapse a tool run — every call lands as its
 * own top-level row paying full inter-message spacing, which is why runs of
 * 3–18 calls used to march down the page.
 *
 * So grouping happens here, ACROSS message boundaries: a contiguous run of
 * assistant thinking + tool activity becomes one `activity` row no matter how
 * many messages produced it. Prose, user messages, bash and dividers stay
 * their own rows, which also keeps ordering intact.
 *
 * Pure and independent of React so the virtualizer can key off the result and
 * the behavior stays unit-testable.
 */

export interface ActivityStep {
  /** Owning assistant item — needed for streaming/stop-reason context. */
  itemId: string
  block: Exclude<AssistantBlock, { type: 'text' }>
  /** The owning item is still streaming. */
  streaming: boolean
  /** This block is the last one in its message (streaming tail detection). */
  isLastInItem: boolean
}

export type TranscriptRow =
  /** A non-assistant item, or one assistant prose block, rendered as-is. */
  | { kind: 'item'; id: string; item: ChatItem }
  | {
      kind: 'text'
      id: string
      item: AssistantItem
      block: Extract<AssistantBlock, { type: 'text' }>
      isLastInItem: boolean
    }
  | { kind: 'activity'; id: string; steps: ActivityStep[] }
  /** Error / aborted tail of an assistant message. */
  | { kind: 'outcome'; id: string; item: AssistantItem }

/**
 * Flatten chat items into renderable rows, merging consecutive assistant
 * activity across messages.
 */
export function buildTranscriptRows(items: ChatItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []

  /** Append to the open activity row, or start one. */
  const pushStep = (step: ActivityStep): void => {
    const last = rows[rows.length - 1]
    if (last?.kind === 'activity') {
      last.steps.push(step)
      return
    }
    rows.push({ kind: 'activity', id: `act-${step.itemId}-${step.block.index}`, steps: [step] })
  }

  for (const item of items) {
    if (item.kind !== 'assistant') {
      rows.push({ kind: 'item', id: item.id, item })
      continue
    }

    const lastIndex = item.blocks[item.blocks.length - 1]?.index
    for (const block of item.blocks) {
      const isLastInItem = block.index === lastIndex
      if (block.type === 'text') {
        rows.push({ kind: 'text', id: `${item.id}-t${block.index}`, item, block, isLastInItem })
      } else {
        pushStep({ itemId: item.id, block, streaming: item.streaming, isLastInItem })
      }
    }

    // An empty streaming turn still needs a row to hang the spinner on.
    if (item.blocks.length === 0 && item.streaming) {
      rows.push({ kind: 'item', id: item.id, item })
    }

    // Errors and aborts belong to their message, after its content.
    if (item.stopReason === 'error' || item.stopReason === 'aborted') {
      rows.push({ kind: 'outcome', id: `${item.id}-out`, item })
    }
  }

  return rows
}

/**
 * The activity row currently receiving the agent's work.
 *
 * A tool can settle before pi starts the next assistant message, so individual
 * tool status is not a reliable lifetime for the expanded group. Keep the
 * newest activity row active across those gaps, but stop as soon as prose is
 * emitted after it so the group can collapse ahead of the answer.
 */
export function activeActivityId(rows: TranscriptRow[], isStreaming: boolean): string | null {
  if (!isStreaming) return null
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row?.kind === 'text' || row?.kind === 'outcome') return null
    if (row?.kind === 'item' && row.item.kind !== 'assistant') return null
    if (row?.kind === 'activity') return row.id
  }
  return null
}

/** True while any step in the group is still producing output. */
export function isActivityLive(steps: ActivityStep[], tools: Record<string, ToolState>): boolean {
  return steps.some((s) => {
    if (s.block.type === 'thinking') {
      return s.streaming && s.isLastInItem && !s.block.closed
    }
    const status = tools[s.block.toolCallId]?.status
    return status === 'starting' || status === 'running'
  })
}

export interface ActivitySummary {
  /** "9 steps" */
  stepLabel: string
  /** "edited 5 files, ran 2 commands" */
  detail: string
  thinkingCount: number
  failedCount: number
}

const NOUNS: Record<string, [string, string]> = {
  Ran: ['command', 'commands'],
  Edited: ['file', 'files'],
  Wrote: ['file', 'files'],
  Read: ['file', 'files'],
  Searched: ['pattern', 'patterns'],
  Found: ['pattern', 'patterns'],
  Listed: ['directory', 'directories'],
  Created: ['artifact', 'artifacts'],
  Updated: ['artifact', 'artifacts'],
}

/**
 * Collapsed-head summary: "9 steps · edited 5 files, ran 2 commands".
 *
 * Counts by verb rather than listing every call — a run of 18 reads must not
 * produce an 18-item string. Verb order follows first appearance so the
 * summary still reflects what happened first.
 */
export function summarizeActivity(
  steps: ActivityStep[],
  tools: Record<string, ToolState>,
  labelFor: (tool: ToolState) => string,
): ActivitySummary {
  const order: string[] = []
  const counts = new Map<string, number>()
  let thinkingCount = 0
  let failedCount = 0

  for (const step of steps) {
    if (step.block.type === 'thinking') {
      thinkingCount++
      continue
    }
    const tool = tools[step.block.toolCallId]
    if (!tool) continue
    if (tool.status === 'error') failedCount++
    const label = labelFor(tool)
    if (!counts.has(label)) order.push(label)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const detail = order
    .map((label) => {
      const n = counts.get(label) ?? 0
      const [one, many] = NOUNS[label] ?? ['tool', 'tools']
      return `${label.toLowerCase()} ${n} ${n === 1 ? one : many}`
    })
    .join(', ')

  const n = steps.length
  return {
    stepLabel: `${n} step${n === 1 ? '' : 's'}`,
    detail,
    thinkingCount,
    failedCount,
  }
}
