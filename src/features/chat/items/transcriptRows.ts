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

/**
 * A tool Claude Code ran INSIDE its own process (WebSearch, WebFetch,
 * ToolSearch, the user's MCP servers, sub-agents) while acting as pi's model
 * provider. pi never sees these as tool calls — it cannot execute them — so
 * the provider extension reports them as one-line marker text blocks. They
 * are real activity, so they belong in the activity group next to pi's own
 * tools rather than in the prose lane, where the raw JSON wrapped across
 * paragraphs and any URL inside it got auto-linkified as markdown.
 */
export interface ExternalToolBlock {
  type: 'externalTool'
  index: number
  /** Tool name as Claude Code reported it, e.g. "WebSearch". */
  name: string
  /**
   * Truncated argument preview, verbatim from the marker. Read best-effort
   * by `externalToolInfo` (it survives truncation); never a hard dependency.
   */
  args?: string
}

/** `[Claude Code · WebSearch {"query":"…"}]` → name + argument preview. */
const EXTERNAL_TOOL_MARKER = /^\[Claude Code · ([^\s\]]+)(?:\s+([\s\S]*))?\]$/

export function parseExternalToolMarker(text: string): { name: string; args?: string } | null {
  const match = EXTERNAL_TOOL_MARKER.exec(text.trim())
  if (!match) return null
  const args = match[2]?.trim()
  return { name: match[1]!, args: args && args.length > 0 ? args : undefined }
}

/** Claude Code's sub-agent tools, as they appear in marker blocks. */
const AGENT_MARKER_NAMES = new Set(['Agent', 'Task'])

export function isAgentMarker(name: string): boolean {
  return AGENT_MARKER_NAMES.has(name)
}

/** What an external-tool row should actually say, instead of raw JSON. */
export interface ExternalToolInfo {
  /** A Claude Code sub-agent launch (Agent/Task). */
  isAgent: boolean
  /** Human headline: the agent's description, or the primary argument. */
  headline?: string
  /** Longer secondary text (the agent's prompt), when recoverable. */
  detail?: string
  /**
   * Every argument that survived the preview cap, unescaped. Exposed so the
   * row can be summarized with the same vocabulary as a pi tool call rather
   * than re-parsing the marker somewhere else.
   */
  fields: Record<string, string>
}

/** Argument keys worth surfacing, most meaningful first. */
const HEADLINE_KEYS = [
  'description',
  'query',
  'url',
  'path',
  'file_path',
  'command',
  'pattern',
  'skill',
  'prompt',
]

/**
 * Unescape a JSON string body that may have been cut mid-escape.
 *
 * `JSON.parse('"…"')` is the only correct unescaper, but it throws on a
 * fragment ending in a lone `\\` or a half-written `\\uXXXX`. Those tails are
 * dropped first; whatever cannot be parsed even then is returned raw, since a
 * slightly over-escaped label beats an empty row.
 */
function unescapeJsonFragment(value: string): string {
  // A half-written `\uXXXX` first, then a dangling escape: an ODD number of
  // trailing backslashes means the last one was going to escape whatever the
  // cap removed. An even number is a complete `\\` and must survive.
  const withoutPartialUnicode = value.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
  const trailingSlashes = /\\*$/.exec(withoutPartialUnicode)?.[0].length ?? 0
  const safe =
    trailingSlashes % 2 === 1 ? withoutPartialUnicode.slice(0, -1) : withoutPartialUnicode
  try {
    return JSON.parse(`"${safe}"`) as string
  } catch {
    return safe
  }
}

/**
 * Best-effort read of a marker's argument preview.
 *
 * The provider caps the preview, so `args` is often TRUNCATED mid-string and
 * `JSON.parse` fails; the fallback pulls out whichever complete `"key":"value"`
 * pairs survived. Values are unescaped through JSON.parse per field so `\"`
 * and `\n` read naturally.
 */
export function externalToolInfo(name: string, args?: string): ExternalToolInfo {
  const isAgent = isAgentMarker(name)
  if (!args) return { isAgent, fields: {} }

  let fields: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(args)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') fields[key] = value
      }
    }
  } catch {
    fields = {}
    const pair = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    for (let match = pair.exec(args); match; match = pair.exec(args)) {
      fields[match[1]!] = unescapeJsonFragment(match[2]!)
    }
    // The pair scan needs a CLOSING quote, so a tool whose only interesting
    // argument is the one the cap cut through recovers nothing at all. That
    // is the common case, not an edge case: every `Bash` marker carries just
    // `command`, so a long command rendered as a bare "Claude Code Bash" row
    // with the command — the entire content of the row — missing.
    // The trailing `\\?` matters: a cut landing right after a backslash leaves
    // one with nothing to escape, which `\\.` cannot consume.
    const dangling = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*\\?)$/.exec(args)
    if (dangling && fields[dangling[1]!] === undefined) {
      fields[dangling[1]!] = unescapeJsonFragment(dangling[2]!)
    }
  }

  if (isAgent) {
    return {
      isAgent,
      fields,
      headline: fields['description'] || fields['subagent_type'] || undefined,
      detail: fields['prompt'] || undefined,
    }
  }
  const key = HEADLINE_KEYS.find((k) => fields[k])
  return { isAgent, fields, headline: key ? fields[key] : undefined }
}

export interface ActivityStep {
  /** Owning assistant item — needed for streaming/stop-reason context. */
  itemId: string
  block: Exclude<AssistantBlock, { type: 'text' }> | ExternalToolBlock
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
        const marker = parseExternalToolMarker(block.text)
        if (marker) {
          pushStep({
            itemId: item.id,
            block: { type: 'externalTool', index: block.index, ...marker },
            streaming: item.streaming,
            isLastInItem,
          })
          continue
        }
        rows.push({ kind: 'text', id: `${item.id}-t${block.index}`, item, block, isLastInItem })
      } else {
        // Encrypted thinking (signature, no plaintext) reaches pi as a
        // thinking block with no text. The provider extension stopped
        // emitting these, but sessions recorded before that fix are on
        // disk forever — and an empty thought renders as a card that
        // expands to nothing, and inflates the "N thoughts" count.
        // A streaming block is legitimately empty for a few frames.
        if (block.type === 'thinking' && !item.streaming && block.text.trim() === '') {
          continue
        }
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

/**
 * Sub-agent launches in the transcript's trailing assistant run — everything
 * after the last user message. Once the user prompts again, Claude Code gets
 * its chance to report on them and the count resets to zero.
 *
 * This is marker counting, not live tracking: the provider today neither
 * streams sub-agent progress nor keeps the CLI alive past the turn's result,
 * so pidex cannot know whether these agents finished (see
 * specs/reference/extensions.md). The strip fed by this says "launched", never
 * "running".
 */
export function trailingAgentLaunches(rows: TranscriptRow[]): number {
  let count = 0
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row?.kind === 'item' && row.item.kind === 'user') break
    if (row?.kind !== 'activity') continue
    for (const step of row.steps) {
      if (step.block.type === 'externalTool' && isAgentMarker(step.block.name)) count++
    }
  }
  return count
}

/** True while any step in the group is still producing output. */
export function isActivityLive(steps: ActivityStep[], tools: Record<string, ToolState>): boolean {
  return steps.some((s) => {
    if (s.block.type === 'externalTool') return false
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
  'Claude Code': ['tool', 'tools'],
  Launched: ['agent', 'agents'],
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
    if (step.block.type === 'externalTool') {
      // Sub-agent launches summarize as "launched N agents", not as
      // anonymous "claude code N tools" — they are the headline of a turn.
      const label = isAgentMarker(step.block.name) ? 'Launched' : 'Claude Code'
      if (!counts.has(label)) order.push(label)
      counts.set(label, (counts.get(label) ?? 0) + 1)
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
