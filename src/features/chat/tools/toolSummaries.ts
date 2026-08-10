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

interface ToolSummary {
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

export function summarizeTool(tool: ToolState): ToolSummary {
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
      return {
        label: running ? 'Running' : 'Ran',
        object: command ? truncate(command, 64) : 'a command',
        mono: !!command,
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
    case 'artifact_update': {
      const updating = tool.toolName === 'artifact_update'
      // While the (large) content field streams, `args` won't parse yet, so
      // recover the title from the raw prefix — models emit `title` first.
      const details = toolDetails<ArtifactToolDetails>(tool)
      const title =
        details?.title ??
        (typeof args?.title === 'string' ? args.title : undefined) ??
        partialStringArg(tool.argsText, 'title')
      const version = details?.version
      return {
        label: running
          ? updating
            ? 'Updating artifact'
            : 'Writing artifact'
          : updating
            ? 'Updated artifact'
            : 'Created artifact',
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
