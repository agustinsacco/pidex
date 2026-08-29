import type { ToolState } from '../reducer'
import { basename } from '@/lib/path'
import { formatBytes } from '@/lib/format'
import type { ArtifactToolDetails } from '@/stores/artifacts'
import { diffStats, parseDisplayDiff, unifiedPatchStats, type DiffStats } from '../diff'

export interface EditDetails {
  diff?: string
  patch?: string
  firstChangedLine?: number
}

export function toolText(tool: ToolState): string {
  const content = (tool.output ?? tool.result)?.content
  if (!content) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
}

/**
 * Read a tool's structured `details`, preferring the final result over the
 * partial output so still-streaming tools still surface what they have.
 */
export function toolDetails<T>(tool: ToolState): T | undefined {
  return (tool.result?.details ?? tool.output?.details) as T | undefined
}

export function editDiffStats(tool: ToolState): DiffStats | null {
  const details = toolDetails<EditDetails>(tool)
  if (details?.diff) return diffStats(parseDisplayDiff(details.diff))
  if (details?.patch) return unifiedPatchStats(details.patch)
  return null
}

export interface ToolSummary {
  /** Leading verb phrase, e.g. "Edited", "Ran a command". */
  label: string
  /** Emphasized object, e.g. file basename or command. */
  object?: string
  /** Monospace object (commands, patterns). */
  mono?: boolean
  stats?: DiffStats | null
  /** Tertiary trailing note, e.g. streamed payload size. */
  hint?: string
}

/**
 * Tense-stable verb for grouped summaries, keyed off the tool name rather
 * than `summarizeTool().label` (which switches to the progressive tense while
 * running — counting by it would split "Read 3" into "Reading 1, Read 2").
 */
export function settledVerb(toolName: string | null): string {
  switch (toolName) {
    case 'read':
      return 'Read'
    case 'bash':
      return 'Ran'
    case 'edit':
      return 'Edited'
    case 'write':
      return 'Wrote'
    case 'grep':
      return 'Searched'
    case 'find':
      return 'Found'
    case 'ls':
      return 'Listed'
    case 'artifact_create':
      return 'Created'
    case 'artifact_update':
      return 'Updated'
    case 'artifact_edit':
      return 'Edited'
    default:
      return 'Used'
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip the session's workspace path out of a bash command for the collapsed
 * label. Models `cd` into the cwd explicitly, and in worktree sessions that
 * path is a long `.pidex/worktrees/…` chain that drowns the actual command —
 * while pi already runs the shell there, so the prefix carries no
 * information. A leading `cd <ws> &&` is dropped entirely; later mentions
 * collapse to the folder's basename. The expanded detail view keeps the full
 * command, so nothing is lost.
 */
export function cleanCommandForDisplay(command: string, workspacePath?: string): string {
  const flat = command.replace(/\s+/g, ' ').trim()
  if (!workspacePath) return flat
  const ws = workspacePath.replace(/[/\\]+$/, '')
  const cdPrefix = new RegExp(
    `^cd\\s+(?:"${escapeRegExp(ws)}"|'${escapeRegExp(ws)}'|${escapeRegExp(ws)})\\s*&&\\s*`,
  )
  const stripped = flat.replace(cdPrefix, '')
  return stripped.split(ws).join(basename(ws))
}

export function summarizeTool(tool: ToolState, workspacePath?: string): ToolSummary {
  const args = tool.args ?? tryParseArgs(tool.argsText)
  const running = tool.status === 'starting' || tool.status === 'running'

  // Identity not yet revealed by the provider (see toolIdentity.ts). Show that
  // args are still arriving instead of a fabricated name; large payloads like
  // `write` or `artifact_create` sit here for a while, so the size is the only
  // honest progress signal available.
  if (!tool.toolName) {
    return {
      label: 'Preparing tool',
      hint: tool.argsText ? formatBytes(tool.argsText.length) : undefined,
    }
  }

  switch (tool.toolName) {
    case 'read': {
      const path = typeof args?.path === 'string' ? basename(args.path) : undefined
      return { label: running ? 'Reading' : 'Read', object: path }
    }
    case 'bash': {
      const command = typeof args?.command === 'string' ? args.command : undefined
      const display = command ? cleanCommandForDisplay(command, workspacePath) : undefined
      return {
        label: running ? 'Running' : 'Ran',
        object: display ? truncate(display, 64) : 'a command',
        mono: !!display,
      }
    }
    case 'edit': {
      const path = typeof args?.path === 'string' ? basename(args.path) : undefined
      return {
        label: running ? 'Editing' : 'Edited',
        object: path,
        stats: editDiffStats(tool),
      }
    }
    case 'write': {
      const path = typeof args?.path === 'string' ? basename(args.path) : undefined
      const content = typeof args?.content === 'string' ? args.content : undefined
      return {
        label: running ? 'Writing' : 'Created',
        object: path,
        stats: content != null ? { additions: content.split('\n').length, deletions: 0 } : null,
      }
    }
    case 'grep': {
      const pattern = typeof args?.pattern === 'string' ? args.pattern : undefined
      return {
        label: running ? 'Searching for' : 'Searched for',
        object: pattern ? truncate(pattern, 48) : undefined,
        mono: true,
      }
    }
    case 'find': {
      const pattern = typeof args?.pattern === 'string' ? args.pattern : undefined
      return {
        label: running ? 'Finding' : 'Found files matching',
        object: pattern ? truncate(pattern, 48) : undefined,
        mono: true,
      }
    }
    case 'ls': {
      const path = typeof args?.path === 'string' ? args.path : undefined
      return { label: running ? 'Listing' : 'Listed', object: path ? basename(path) : 'directory' }
    }
    case 'artifact_create':
    case 'artifact_update':
    case 'artifact_edit': {
      // Distinct verbs per tool: "Edited" is the cheap targeted revision,
      // "Updated" the whole-document rewrite. Conflating them hid which one ran.
      const verb =
        tool.toolName === 'artifact_edit'
          ? ({ running: 'Editing artifact', done: 'Edited artifact' } as const)
          : tool.toolName === 'artifact_update'
            ? ({ running: 'Updating artifact', done: 'Updated artifact' } as const)
            : ({ running: 'Writing artifact', done: 'Created artifact' } as const)
      // While the (large) content field streams, `args` won't parse yet, so
      // recover the title from the raw prefix — models emit `title` first.
      const details = toolDetails<ArtifactToolDetails>(tool)
      const title =
        details?.title ??
        (typeof args?.title === 'string' ? args.title : undefined) ??
        partialStringArg(tool.argsText, 'title')
      const version = details?.version
      return {
        label: running ? verb.running : verb.done,
        object: title ? truncate(title, 56) : undefined,
        hint: running
          ? tool.argsText
            ? formatBytes(tool.argsText.length)
            : undefined
          : version != null
            ? `v${version}`
            : undefined,
      }
    }
    default:
      return { label: running ? 'Running' : 'Used', object: tool.toolName, mono: true }
  }
}

export function tryParseArgs(argsText: string): Record<string, unknown> | undefined {
  if (!argsText) return undefined
  try {
    const parsed = JSON.parse(argsText)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Best-effort read of one string field out of a *partially streamed* JSON args
 * payload, for labelling a tool card before its arguments finish arriving.
 * Returns undefined unless the value's closing quote has streamed, so a
 * half-arrived title never renders truncated-but-confident.
 */
export function partialStringArg(argsText: string, key: string): string | undefined {
  const at = argsText.indexOf(`"${key}"`)
  if (at === -1) return undefined
  const colon = argsText.indexOf(':', at + key.length + 2)
  if (colon === -1) return undefined
  let i = colon + 1
  while (i < argsText.length && /\s/.test(argsText[i]!)) i++
  if (argsText[i] !== '"') return undefined
  i++
  let value = ''
  while (i < argsText.length) {
    const char = argsText[i]!
    if (char === '\\') {
      const next = argsText[i + 1]
      if (next === undefined) return undefined
      const simple = JSON_ESCAPES[next]
      if (simple !== undefined) {
        value += simple
        i += 2
        continue
      }
      if (next === 'u') {
        const hex = argsText.slice(i + 2, i + 6)
        // Half-arrived or malformed \uXXXX: under-label rather than mangle.
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return undefined
        value += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      // Unknown escape — this function's contract is "never render
      // truncated-but-confident", so bail instead of guessing.
      return undefined
    }
    if (char === '"') return value
    value += char
    i++
  }
  return undefined
}

/** The JSON single-character escapes (\uXXXX handled separately). */
const JSON_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/**
 * The same summary shape for a tool Claude Code ran inside its own process.
 *
 * These arrive as `[Claude Code · Name {args}]` markers rather than as pi
 * tool calls, and they used to render as `Claude Code | Bash | <raw arg>` —
 * a different verb, a different type scale and no path cleanup, sitting
 * directly above pi's own `Ran <command>` rows in the same run. Two
 * vocabularies for the same act made one turn read like two transcripts.
 *
 * So the mapping is deliberate rather than incidental: Claude Code's tool
 * names resolve to the verbs `summarizeTool` already uses, and the argument
 * keys of both spellings (`path` and `file_path`) are accepted, because the
 * marker carries Claude's names while pi's own tools carry pi's.
 *
 * What CANNOT be borrowed is status and output. The provider forwards the
 * invocation and nothing else — no `tool_result` — so these rows are always
 * settled and never expandable. Never infer a result here.
 */
export function summarizeExternalTool(
  name: string,
  fields: Record<string, string>,
  workspacePath?: string,
): ToolSummary {
  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) if (fields[key]) return fields[key]
    return undefined
  }
  const file = (...keys: string[]): string | undefined => {
    const value = first(...keys)
    return value ? basename(value) : undefined
  }

  switch (name) {
    case 'Bash':
    case 'BashOutput': {
      const command = first('command')
      const display = command ? cleanCommandForDisplay(command, workspacePath) : undefined
      return {
        label: 'Ran',
        object: display ? truncate(display, 64) : 'a command',
        mono: !!display,
      }
    }
    case 'Read':
    case 'NotebookRead':
      return { label: 'Read', object: file('file_path', 'path', 'notebook_path') }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: 'Edited', object: file('file_path', 'path', 'notebook_path') }
    case 'Write':
      return { label: 'Created', object: file('file_path', 'path') }
    case 'Grep':
      return { label: 'Searched for', object: truncate(first('pattern') ?? '', 48), mono: true }
    case 'Glob':
      return {
        label: 'Found files matching',
        object: truncate(first('pattern') ?? '', 48),
        mono: true,
      }
    case 'LS':
      return { label: 'Listed', object: file('path') ?? 'directory' }
    case 'WebSearch':
      return { label: 'Searched the web for', object: truncate(first('query') ?? '', 64) }
    case 'WebFetch':
      return { label: 'Fetched', object: truncate(first('url') ?? '', 64), mono: true }
    case 'Skill':
      return { label: 'Used skill', object: first('skill', 'command') }
    case 'ToolSearch':
      return { label: 'Searched tools for', object: truncate(first('query') ?? '', 48) }
    default: {
      // Unknown tools keep their NAME as the emphasis — an MCP tool called
      // `mcp__linear__save_issue` says more than any verb we could invent —
      // and any headline argument trails it as context.
      const detail = first(...EXTERNAL_HEADLINE_KEYS)
      return {
        label: 'Used',
        object: name,
        hint: detail ? truncate(detail.replace(/\s+/g, ' '), 48) : undefined,
      }
    }
  }
}

/** Argument keys worth surfacing for an unrecognised external tool. */
const EXTERNAL_HEADLINE_KEYS = [
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
