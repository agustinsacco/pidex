import { memo, useState } from 'react'
import clsx from 'clsx'
import type { ToolState } from '../reducer'
import { summarizeTool } from './toolSummaries'
import { ChevronIcon } from '@/components/icons'
import {
  BashDetail,
  EditDetail,
  GenericDetail,
  ListDetail,
  ReadDetail,
  WriteDetail,
} from './toolDetails'

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
        {running && (
          <span
            aria-hidden
            className="bg-accent tool-running-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
        )}
        <span className={clsx('shrink-0', running && 'tool-running-label')}>{summary.label}</span>
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
        <ChevronIcon expanded={expanded} className="text-text-tertiary" />
      </button>
      {expanded && (
        <div className="border-border bg-surface expand-enter mb-2 mt-0.5 overflow-hidden rounded-lg border">
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
