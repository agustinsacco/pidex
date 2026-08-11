import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import type { ResourceSnapshot, SessionUsage } from '@shared/models'
import { useResourcesStore } from './resourcesStore'
import { useSessionsStore } from '@/stores/sessions'
import { useChatStore } from '@/stores/chat'
import { workspaceName } from '@/lib/path'
import { sessionTitle } from '@/lib/sessionTitle'

/** kB (what `ps rss=` and Electron's workingSetSize report) → human string. */
export function formatRss(rssKb: number): string {
  if (rssKb <= 0) return '—'
  if (rssKb < 1024) return `${Math.round(rssKb)} KB`
  const mb = rssKb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function formatCpu(percent: number): string {
  if (percent < 0.05) return '0%'
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`
}

/** Subscribe for as long as this component is mounted. */
export function useResourceSubscription(): void {
  useEffect(() => useResourcesStore.getState().addViewer(), [])
}

/**
 * Sparkline over a bounded history window. Deliberately an inline SVG polyline
 * rather than a chart library: it renders once per tick per row, so the cheap
 * thing is the right thing.
 */
function Sparkline({
  series,
  className,
}: {
  series: number[]
  className?: string
}): React.JSX.Element {
  const points = useMemo(() => {
    if (series.length < 2) return ''
    const max = Math.max(...series)
    const min = Math.min(...series)
    const range = max - min || 1
    const step = 100 / (series.length - 1)
    return series
      .map(
        (value, i) => `${(i * step).toFixed(2)},${(20 - ((value - min) / range) * 18).toFixed(2)}`,
      )
      .join(' ')
  }, [series])

  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className={clsx('h-5 w-full', className)}
      aria-hidden
    >
      {points && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

/** Live title for a session, falling back to its workspace name. */
function useSessionLabel(usage: SessionUsage): string {
  const explicitName = useChatStore((s) => s.sessions[usage.sessionId]?.meta?.sessionName)
  const firstUserText = useChatStore(
    (s) => s.sessions[usage.sessionId]?.items.find((item) => item.kind === 'user')?.text,
  )
  return (
    sessionTitle({ explicitName, firstUserText }) ?? workspaceName(usage.workspacePath) ?? 'Session'
  )
}

function SessionRow({
  usage,
  includeTerminals,
  history,
  peakRss,
  compact,
}: {
  usage: SessionUsage
  includeTerminals: boolean
  history: number[]
  peakRss: number
  compact: boolean
}): React.JSX.Element {
  const label = useSessionLabel(usage)
  const shown = includeTerminals ? usage.total : usage.agent
  const isActive = useSessionsStore((s) => s.activeSessionId === usage.sessionId)
  // Bar is relative to the heaviest session so the comparison is legible.
  const share = peakRss > 0 ? Math.min(100, (shown.rssKb / peakRss) * 100) : 0

  return (
    <div
      data-testid="monitor-session-row"
      className="border-border/60 border-b px-3 py-2 last:border-b-0"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px]">
          {isActive && <span className="bg-success mr-1.5 inline-block h-1.5 w-1.5 rounded-full" />}
          {label}
        </span>
        <span className="text-text shrink-0 text-[12px] font-semibold tabular-nums">
          {formatRss(shown.rssKb)}
        </span>
        <span className="text-text-secondary w-11 shrink-0 text-right text-[12px] tabular-nums">
          {formatCpu(shown.cpuPercent)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className="bg-bg-secondary h-1 flex-1 overflow-hidden rounded-full">
          <div className="bg-accent h-full rounded-full" style={{ width: `${share}%` }} />
        </div>
        {!compact && (
          <span className="text-text-tertiary shrink-0 text-[10px] tabular-nums">
            {shown.processCount} proc
            {includeTerminals && usage.terminals.processCount > 0 && (
              <span title="Processes running in this session's terminals">
                {' '}
                · {usage.terminals.processCount} term
              </span>
            )}
          </span>
        )}
      </div>

      {!compact && history.length > 1 && (
        <Sparkline series={history} className="text-accent/70 mt-1" />
      )}
    </div>
  )
}

/**
 * The monitor body, shared by the in-app modal and the floating window so both
 * always show the same numbers.
 */
export function MonitorPanel({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const latest = useResourcesStore((s) => s.latest)
  const historyBySession = useResourcesStore((s) => s.historyBySession)
  const cpuHistory = useResourcesStore((s) => s.cpuHistory)
  const includeTerminals = useResourcesStore((s) => s.includeTerminals)

  if (!latest) {
    return (
      <div className="text-text-tertiary flex flex-1 items-center justify-center p-6 text-[12px]">
        Sampling…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Totals snapshot={latest} cpuHistory={cpuHistory} compact={compact} />

      <label className="border-border text-text-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11.5px]">
        <input
          type="checkbox"
          checked={includeTerminals}
          data-testid="monitor-include-terminals"
          onChange={(event) =>
            useResourcesStore.getState().setIncludeTerminals(event.target.checked)
          }
          className="accent-accent"
        />
        Include terminal processes
        <span className="text-text-tertiary" title="Builds, tests and dev servers you started here">
          (builds, tests, servers)
        </span>
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!latest.perSessionSupported && (
          <div className="text-text-tertiary px-3 py-3 text-[11.5px]">
            Per-session process metrics aren&apos;t available on this platform. The totals above
            cover pidex&apos;s own processes only.
          </div>
        )}
        {latest.sessions.length === 0 ? (
          <div className="text-text-tertiary px-3 py-3 text-[11.5px]">No live sessions.</div>
        ) : (
          [...latest.sessions]
            .sort((a, b) => {
              const value = (s: SessionUsage) => (includeTerminals ? s.total : s.agent).rssKb
              return value(b) - value(a)
            })
            .map((usage) => (
              <SessionRow
                key={usage.sessionId}
                usage={usage}
                includeTerminals={includeTerminals}
                history={historyBySession[usage.sessionId] ?? []}
                peakRss={Math.max(
                  ...latest.sessions.map((s) => (includeTerminals ? s.total : s.agent).rssKb),
                  1,
                )}
                compact={compact}
              />
            ))
        )}
      </div>
    </div>
  )
}

function Totals({
  snapshot,
  cpuHistory,
  compact,
}: {
  snapshot: ResourceSnapshot
  cpuHistory: number[]
  compact: boolean
}): React.JSX.Element {
  const includeTerminals = useResourcesStore((s) => s.includeTerminals)
  const sessionRss = snapshot.sessions.reduce(
    (total, s) => total + (includeTerminals ? s.total : s.agent).rssKb,
    0,
  )
  const sessionCpu = snapshot.sessions.reduce(
    (total, s) => total + (includeTerminals ? s.total : s.agent).cpuPercent,
    0,
  )

  return (
    <div className="border-border shrink-0 border-b px-3 py-2.5">
      <div className="flex items-baseline gap-3">
        <Metric label="Sessions" value={formatRss(sessionRss)} sub={formatCpu(sessionCpu)} />
        <Metric
          label="pidex"
          value={formatRss(snapshot.app.rssKb)}
          sub={formatCpu(snapshot.app.cpuPercent)}
        />
        {!compact && <Metric label="Live" value={String(snapshot.sessions.length)} />}
      </div>
      {cpuHistory.length > 1 && <Sparkline series={cpuHistory} className="text-warning/70 mt-1" />}
      {/*
        RSS counts pages shared between processes once per process, so summing
        per-process numbers overstates real usage. Say so rather than present a
        falsely precise total.
      */}
      <div className="text-text-tertiary mt-1 text-[10px]">
        Resident memory; shared pages counted per process
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-text-tertiary font-mono text-[9.5px] uppercase tracking-wider">
        {label}
      </div>
      <div className="text-text text-[15px] font-semibold tabular-nums">
        {value}
        {sub && <span className="text-text-tertiary ml-1 text-[11px] font-normal">{sub}</span>}
      </div>
    </div>
  )
}
