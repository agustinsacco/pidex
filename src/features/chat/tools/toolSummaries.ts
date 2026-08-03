import type { ToolState } from '../reducer'
import { diffStats, parseDisplayDiff, unifiedPatchStats, type DiffStats } from '../diff'

export interface EditDetails {
  diff?: string
  patch?: string
  firstChangedLine?: number
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

export function toolText(tool: ToolState): string {
  const content = (tool.output ?? tool.result)?.content
  if (!content) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
}

export function editDiffStats(tool: ToolState): DiffStats | null {
  const details = (tool.result?.details ?? tool.output?.details) as EditDetails | undefined
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
}

export function summarizeTool(tool: ToolState): ToolSummary {
  const args = tool.args ?? tryParseArgs(tool.argsText)
  const running = tool.status === 'starting' || tool.status === 'running'

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

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}
