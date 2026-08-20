import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SessionMeta, UsageSummary, UsageTotals } from '@shared/models'
import { ModalOverlay } from '@/components/Modal'
import { StatTile } from '@/components/StatTile'
import { ChevronIcon, Spinner } from '@/components/icons'
import { useUsageUiStore } from './usageUiStore'
import { useSessionsStore } from '@/stores/sessions'
import { formatCost, formatTokens } from '@/lib/format'
import { relativeTimeShort } from '@/lib/time'
import { workspaceName } from '@/lib/path'
import {
  DEFAULT_SORT,
  nextSort,
  sortSessions,
  sortWorkspaces,
  type UsageSort,
  type UsageSortKey,
} from './usageSort'

/**
 * Usage view: cost and token rollups for every session pi has on disk,
 * grouped by workspace. Data comes from the session scanner (JSONL files),
 * so it covers dead sessions too — not just live ones.
 */
export function UsageModal(): React.JSX.Element | null {
  const open = useUsageUiStore((s) => s.open)
  if (!open) return null
  return <UsageModalBody onClose={() => useUsageUiStore.getState().setOpen(false)} />
}

function UsageModalBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [sort, setSort] = useState<UsageSort>(DEFAULT_SORT)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void window.pidex.invoke('sessions:usage').then(setSummary)
  }, [])

  const workspaces = useMemo(
    () => (summary ? sortWorkspaces(summary.workspaces, sort) : []),
    [summary, sort],
  )

  const openSession = (meta: SessionMeta): void => {
    onClose()
    void useSessionsStore.getState().openDiskSession(meta.cwd, meta)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="border-border bg-surface flex h-[80vh] w-[960px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div>
            <div className="text-lg font-semibold">Usage</div>
            <div className="text-text-tertiary text-sm">
              Every session on disk, priced by pi from each model&apos;s configured rates
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text rounded-md px-2 py-1 text-base transition-colors"
          >
            Close
          </button>
        </div>

        {summary === null ? (
          <div className="flex flex-1 items-center justify-center gap-2">
            <Spinner />
            <span className="text-text-tertiary text-base">Scanning session files…</span>
          </div>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-5 gap-2.5 px-5 pb-1 pt-4">
              <StatTile label="Total cost" value={formatCost(summary.totals.cost)} />
              <StatTile label="Input tokens" value={formatTokens(summary.totals.inputTokens)} />
              <StatTile label="Output tokens" value={formatTokens(summary.totals.outputTokens)} />
              <StatTile label="Cache read" value={formatTokens(summary.totals.cacheReadTokens)} />
              <StatTile label="Sessions" value={String(summary.totals.sessionCount)} />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
              <HeaderRow sort={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />
              {workspaces.map((ws) => {
                const isCollapsed = collapsed[ws.workspacePath] ?? false
                return (
                  <div key={ws.workspacePath} className="mt-1.5">
                    <button
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [ws.workspacePath]: !isCollapsed }))
                      }
                      title={ws.workspacePath}
                      className="bg-bg-secondary/60 hover:bg-bg-secondary flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors"
                    >
                      <ChevronIcon size={9} strokeWidth={3} expanded={!isCollapsed} />
                      <span className="text-text min-w-0 flex-1 truncate text-base font-medium">
                        {workspaceName(ws.workspacePath)}
                      </span>
                      <TotalsCells totals={ws.totals} />
                    </button>
                    {!isCollapsed &&
                      sortSessions(ws.sessions, sort).map((meta) => (
                        <button
                          key={meta.path}
                          onClick={() => openSession(meta)}
                          className="hover:bg-bg-secondary/60 flex w-full items-center gap-1.5 rounded-md py-1 pl-6 pr-2 text-left transition-colors"
                          title={meta.path}
                        >
                          <span className="text-text-secondary min-w-0 flex-1 truncate text-base">
                            {meta.name || meta.firstUserText || 'Untitled session'}
                          </span>
                          <SessionCells meta={meta} />
                        </button>
                      ))}
                  </div>
                )
              })}
              {workspaces.length === 0 && (
                <div className="text-text-tertiary py-10 text-center text-base">
                  No sessions found on disk.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

const COLUMNS: Array<{ key: UsageSortKey; label: string; width: string }> = [
  { key: 'cost', label: 'Cost', width: 'w-16' },
  { key: 'tokens', label: 'In', width: 'w-14' },
  { key: 'tokens', label: 'Out', width: 'w-14' },
  { key: 'tokens', label: 'Cache R', width: 'w-16' },
  { key: 'tokens', label: 'Cache W', width: 'w-16' },
  { key: 'messages', label: 'Msgs', width: 'w-12' },
  { key: 'toolCalls', label: 'Tools', width: 'w-12' },
  { key: 'lastActivity', label: 'Active', width: 'w-12' },
]

function HeaderRow({
  sort,
  onSort,
}: {
  sort: UsageSort
  onSort: (key: UsageSortKey) => void
}): React.JSX.Element {
  return (
    <div className="text-text-tertiary flex items-center gap-1.5 px-2 pb-1 font-mono text-2xs uppercase tracking-wider">
      <span className="min-w-0 flex-1">Session</span>
      {COLUMNS.map((col, i) => (
        <button
          key={`${col.label}-${i}`}
          onClick={() => onSort(col.key)}
          className={clsx(
            'shrink-0 text-right transition-colors hover:text-[var(--px-text)]',
            col.width,
            sort.key === col.key && 'text-text font-semibold',
          )}
        >
          {col.label}
          {sort.key === col.key && (sort.direction === 'desc' ? ' ↓' : ' ↑')}
        </button>
      ))}
    </div>
  )
}

function Cell({ children, width }: { children: string; width: string }): React.JSX.Element {
  return (
    <span
      className={clsx(
        'text-text-secondary shrink-0 text-right font-mono text-sm tabular-nums',
        width,
      )}
    >
      {children}
    </span>
  )
}

function TotalsCells({ totals }: { totals: UsageTotals }): React.JSX.Element {
  return (
    <>
      <Cell width="w-16">{formatCost(totals.cost)}</Cell>
      <Cell width="w-14">{formatTokens(totals.inputTokens)}</Cell>
      <Cell width="w-14">{formatTokens(totals.outputTokens)}</Cell>
      <Cell width="w-16">{formatTokens(totals.cacheReadTokens)}</Cell>
      <Cell width="w-16">{formatTokens(totals.cacheWriteTokens)}</Cell>
      <Cell width="w-12">{String(totals.messages)}</Cell>
      <Cell width="w-12">{String(totals.toolCalls)}</Cell>
      <Cell width="w-12">{`${totals.sessionCount}×`}</Cell>
    </>
  )
}

function SessionCells({ meta }: { meta: SessionMeta }): React.JSX.Element {
  return (
    <>
      <Cell width="w-16">{formatCost(meta.cost)}</Cell>
      <Cell width="w-14">{formatTokens(meta.inputTokens)}</Cell>
      <Cell width="w-14">{formatTokens(meta.outputTokens)}</Cell>
      <Cell width="w-16">{formatTokens(meta.cacheReadTokens)}</Cell>
      <Cell width="w-16">{formatTokens(meta.cacheWriteTokens)}</Cell>
      <Cell width="w-12">{String(meta.userMessages + meta.assistantMessages)}</Cell>
      <Cell width="w-12">{String(meta.toolCalls)}</Cell>
      <Cell width="w-12">{relativeTimeShort(meta.mtimeMs)}</Cell>
    </>
  )
}
