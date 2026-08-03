import { memo, useState } from 'react'
import clsx from 'clsx'
import type { ToolState } from '../reducer'
import {
  editDiffStats,
  summarizeTool,
  toolText,
  tryParseArgs,
  type EditDetails,
} from './toolSummaries'
import { DiffView } from './DiffView'
import { CodeBlock } from '@/components/markdown/CodeBlock'
import { CopyButton } from '@/components/CopyButton'
import { Lightbox } from '@/components/Lightbox'
import { openFileInWorkspace } from '@/stores/layout'
import { useWorkspacesStore } from '@/stores/workspaces'

/** Clickable path chip: opens the file in the Files pane (optionally at a line). */
function PathLink({ path, line }: { path: string; line?: number }): React.JSX.Element {
  const open = (): void => {
    const workspacePath = useWorkspacesStore.getState().currentPath
    if (workspacePath) void openFileInWorkspace(workspacePath, path, line)
  }
  return (
    <button
      onClick={open}
      title={line !== undefined ? `Open at line ${line}` : 'Open in Files pane'}
      className="text-text hover:text-accent truncate text-left font-mono text-[12px] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
    >
      {path}
    </button>
  )
}

/**
 * One tool execution as a collapsed row (screenshot style) that expands to a
 * tool-specific detail view. Unknown/extension tools use the generic branch.
 */
export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolState }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeTool(tool)
  const running = tool.status === 'starting' || tool.status === 'running'
  const failed = tool.status === 'error'

  return (
    <div className="tool-card">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={clsx(
          'group flex w-full items-center gap-1.5 py-1 text-left text-[13.5px] transition-colors',
          failed ? 'text-danger' : 'text-text-secondary hover:text-text',
        )}
      >
        {running && <Spinner />}
        <span className="shrink-0">{summary.label}</span>
        {summary.object && (
          <span
            className={clsx(
              'truncate font-medium',
              failed ? 'text-danger' : 'text-text',
              summary.mono && 'font-mono text-[12.5px]',
            )}
          >
            {summary.object}
          </span>
        )}
        {summary.stats && (
          <span className="shrink-0 font-mono text-[12px]">
            <span className="text-success">+{summary.stats.additions}</span>{' '}
            <span className="text-danger">−{summary.stats.deletions}</span>
          </span>
        )}
        {failed && (
          <span className="bg-danger-soft text-danger shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium">
            failed
          </span>
        )}
        <Chevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="border-border bg-surface mb-2 mt-0.5 overflow-hidden rounded-lg border">
          <ToolDetail tool={tool} />
        </div>
      )}
    </div>
  )
})

function ToolDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  switch (tool.toolName) {
    case 'bash':
      return <BashDetail tool={tool} />
    case 'edit':
      return <EditDetail tool={tool} />
    case 'write':
      return <WriteDetail tool={tool} />
    case 'read':
      return <ReadDetail tool={tool} />
    case 'grep':
    case 'find':
    case 'ls':
      return <ListDetail tool={tool} />
    default:
      return <GenericDetail tool={tool} />
  }
}

// ---------- per-tool detail views ----------

function BashDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const command = typeof tool.args?.command === 'string' ? tool.args.command : tool.argsText
  const output = toolText(tool)
  const details = (tool.result?.details ?? tool.output?.details) as
    { fullOutputPath?: string | null; truncation?: { truncated?: boolean } | null } | undefined
  const running = tool.status === 'starting' || tool.status === 'running'
  const durationMs = tool.startedAt && tool.endedAt ? tool.endedAt - tool.startedAt : null

  return (
    <div>
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <code className="text-text flex-1 truncate font-mono text-[12px]">$ {command}</code>
        <div className="flex shrink-0 items-center gap-2">
          {durationMs !== null && (
            <span className="text-text-tertiary text-[11px]">{formatDuration(durationMs)}</span>
          )}
          {running ? (
            <span className="text-text-tertiary text-[11px]">running…</span>
          ) : (
            <span
              className={clsx(
                'rounded px-1.5 py-px font-mono text-[10.5px] font-medium',
                tool.isError ? 'bg-danger-soft text-danger' : 'bg-success/15 text-success',
              )}
            >
              {tool.isError ? 'error' : 'exit 0'}
            </span>
          )}
          <CopyButton text={output} />
        </div>
      </div>
      <pre className="terminal-output max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
        {output || (running ? '…' : '(no output)')}
      </pre>
      {details?.fullOutputPath && (
        <div className="border-border text-text-tertiary border-t px-3 py-1.5 text-[11px]">
          Output truncated — full log at <code className="font-mono">{details.fullOutputPath}</code>
        </div>
      )}
    </div>
  )
}

function EditDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const details = (tool.result?.details ?? tool.output?.details) as EditDetails | undefined
  const path = typeof tool.args?.path === 'string' ? tool.args.path : ''
  const stats = editDiffStats(tool)

  return (
    <div>
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <PathLink path={path} line={details?.firstChangedLine} />
        {stats && (
          <span className="shrink-0 font-mono text-[11.5px]">
            <span className="text-success">+{stats.additions}</span>{' '}
            <span className="text-danger">−{stats.deletions}</span>
          </span>
        )}
      </div>
      {details?.diff ? (
        <DiffView diff={details.diff} />
      ) : tool.isError ? (
        <ErrorText text={toolText(tool)} />
      ) : (
        <div className="text-text-tertiary px-3 py-2 text-[12px]">Waiting for diff…</div>
      )}
    </div>
  )
}

function WriteDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const path = typeof tool.args?.path === 'string' ? tool.args.path : ''
  const content = typeof tool.args?.content === 'string' ? tool.args.content : ''
  const language = path.split('.').pop() ?? 'text'

  if (tool.isError) return <ErrorText text={toolText(tool)} />
  return (
    <div className="[&_.code-block]:my-0 [&_.code-block]:rounded-none [&_.code-block]:border-0">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <PathLink path={path} />
      </div>
      <div className="max-h-80 overflow-auto">
        <CodeBlock code={content} language={language} />
      </div>
    </div>
  )
}

function ReadDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const path = typeof tool.args?.path === 'string' ? tool.args.path : ''
  const offset = typeof tool.args?.offset === 'number' ? tool.args.offset : undefined
  const limit = typeof tool.args?.limit === 'number' ? tool.args.limit : undefined
  const content = tool.result?.content ?? tool.output?.content ?? []
  const text = toolText(tool)
  const images = content.filter((b) => b.type === 'image')

  if (tool.isError) return <ErrorText text={text} />
  return (
    <div>
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex min-w-0 items-baseline gap-0.5">
          <PathLink path={path} line={offset} />
          {offset != null && (
            <span className="text-text-tertiary font-mono text-[12px]">
              :{offset}
              {limit != null ? `–${offset + limit}` : ''}
            </span>
          )}
        </span>
        <CopyButton text={text} />
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3">
          {images.map((img, i) =>
            img.type === 'image' ? (
              <ZoomableImage key={i} data={img.data} mimeType={img.mimeType} />
            ) : null,
          )}
        </div>
      )}
      {text && (
        <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  )
}

function ListDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const text = toolText(tool)
  const details = (tool.result?.details ?? tool.output?.details) as
    | { matchLimitReached?: number; resultLimitReached?: number; entryLimitReached?: number }
    | undefined
  const limit =
    details?.matchLimitReached ?? details?.resultLimitReached ?? details?.entryLimitReached

  if (tool.isError) return <ErrorText text={text} />
  return (
    <div>
      <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
        {text || '(no results)'}
      </pre>
      {limit != null && (
        <div className="border-border text-text-tertiary border-t px-3 py-1.5 text-[11px]">
          Result limit reached ({limit}) — output truncated
        </div>
      )}
    </div>
  )
}

/** Unknown/extension tools: name, pretty args, streaming output, error state. */
function GenericDetail({ tool }: { tool: ToolState }): React.JSX.Element {
  const [argsExpanded, setArgsExpanded] = useState(false)
  const args = tool.args ?? tryParseArgs(tool.argsText)
  const argsJson = args ? JSON.stringify(args, null, 2) : tool.argsText
  const text = toolText(tool)
  const images = (tool.result?.content ?? tool.output?.content ?? []).filter(
    (b) => b.type === 'image',
  )
  const running = tool.status === 'starting' || tool.status === 'running'

  return (
    <div>
      <div className="border-border border-b px-3 py-2">
        <button
          onClick={() => setArgsExpanded((e) => !e)}
          className="text-text-tertiary hover:text-text flex items-center gap-1 text-[11.5px] transition-colors"
        >
          <Chevron expanded={argsExpanded} />
          <span className="font-mono">{tool.toolName}</span>
          <span>arguments</span>
        </button>
        {argsExpanded && (
          <pre className="bg-code-bg border-border mt-2 max-h-60 overflow-auto rounded-md border px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {argsJson || '(none)'}
          </pre>
        )}
      </div>
      {tool.isError ? (
        <ErrorText text={text} />
      ) : (
        <>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3">
              {images.map((img, i) =>
                img.type === 'image' ? (
                  <ZoomableImage key={i} data={img.data} mimeType={img.mimeType} />
                ) : null,
              )}
            </div>
          )}
          <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            {text || (running ? 'Running…' : '(no output)')}
          </pre>
        </>
      )}
    </div>
  )
}

// ---------- shared bits ----------

function ErrorText({ text }: { text: string }): React.JSX.Element {
  return (
    <pre className="text-danger max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
      {text || 'Tool failed'}
    </pre>
  )
}

function ZoomableImage({ data, mimeType }: { data: string; mimeType: string }): React.JSX.Element {
  const [zoomed, setZoomed] = useState(false)
  const src = `data:${mimeType};base64,${data}`
  return (
    <>
      <img
        src={src}
        className="max-h-64 cursor-zoom-in rounded-md"
        onClick={() => setZoomed(true)}
      />
      {zoomed && (
        <Lightbox onClose={() => setZoomed(false)}>
          <img src={src} className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        </Lightbox>
      )}
    </>
  )
}

export function Spinner(): React.JSX.Element {
  return (
    <svg className="text-accent h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
      />
    </svg>
  )
}

function Chevron({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={clsx(
        'text-text-tertiary shrink-0 transition-transform duration-150',
        expanded && 'rotate-90',
      )}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
