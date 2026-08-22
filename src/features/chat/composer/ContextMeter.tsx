import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useChatStore } from '@/stores/chat'
import { PopupMenu } from '@/components/PopupMenu'
import { formatCost, formatTokens } from '@/lib/format'
import { hasNoPricing } from './pricing'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'
import { useExtensionUiStore } from '@/stores/extensionUi'
import {
  CONTEXT_BREAKDOWN_STATUS_KEY,
  breakdownSlices,
  parseContextBreakdown,
} from './contextBreakdown'
import { RATE_LIMIT_STATUS_KEY, parseRateLimit, resetLabel, windowLabel } from './rateLimit'
import { assessBurn, burnSamples } from '@/lib/burnRate'

export function ContextMeter({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const stats = useChatStore((s) => s.sessions[sessionId]?.stats)
  const model = useChatStore((s) => s.sessions[sessionId]?.meta?.model)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Pushed by the bundled context-breakdown extension, so it is present for
  // every provider — including ones pidex knows nothing about.
  const breakdownStatus = useExtensionUiStore(
    (s) => s.statuses[sessionId]?.[CONTEXT_BREAKDOWN_STATUS_KEY],
  )
  // Only sessions served by the Claude Code provider push this; every other
  // provider leaves the key unset and the section stays hidden.
  const rateLimitStatus = useExtensionUiStore((s) => s.statuses[sessionId]?.[RATE_LIMIT_STATUS_KEY])

  const usage = stats?.contextUsage
  if (!stats || !usage || usage.percent == null) return null

  const percent = Math.min(100, Math.round(usage.percent))
  const warn = percent >= 75
  const critical = percent >= 90
  // Spending fast while producing nothing is invisible in the percentage — a
  // stuck tool loop can bill millions without the meter moving.
  const burn = assessBurn(burnSamples(sessionId), Date.now())
  const burning = burn?.level === 'runaway' || burn?.level === 'elevated'

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title={`Context: ${percent}% of ${formatTokens(usage.contextWindow)}`}
        className="hover:bg-bg-secondary flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" className="-rotate-90">
          <circle
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke="var(--px-border-strong)"
            strokeWidth="2"
          />
          <circle
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke={
              critical ? 'var(--px-danger)' : warn ? 'var(--px-warning)' : 'var(--px-success)'
            }
            strokeWidth="2"
            strokeDasharray={`${(percent / 100) * 40.8} 40.8`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className={clsx(
            'text-sm tabular-nums',
            critical ? 'text-danger' : warn ? 'text-warning' : 'text-text-tertiary',
          )}
        >
          {percent}%
        </span>
        {burning && (
          <span
            className={clsx(
              'text-2xs font-mono uppercase tracking-wide',
              burn.level === 'runaway' ? 'text-danger' : 'text-warning',
            )}
          >
            {formatTokens(Math.round(burn.tokensPerMinute))}/min
          </span>
        )}
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute bottom-full right-0 mb-2 w-80 p-3"
        >
          <div className="text-text text-base font-medium">Session usage</div>
          {burning && (
            <div
              className={clsx(
                'mt-2 rounded-md border px-2.5 py-2 text-sm leading-snug',
                burn.level === 'runaway'
                  ? 'border-danger/30 bg-danger-soft text-danger'
                  : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              Burning {formatTokens(Math.round(burn.tokensPerMinute))} tokens/min with{' '}
              {(burn.yield * 100).toFixed(1)}% going to output. The agent may be repeating itself —
              worth stopping the turn and checking.
            </div>
          )}
          <div className="mt-2 space-y-1 text-base">
            <SectionLabel>Context</SectionLabel>
            <StatRow
              label="Window"
              value={`${formatTokens(usage.tokens ?? 0)} / ${formatTokens(usage.contextWindow)} (${percent}%)`}
            />
            <ContextComposition
              statusText={breakdownStatus}
              total={usage.tokens ?? 0}
              window={usage.contextWindow}
            />
            <SectionLabel>Tokens</SectionLabel>
            <StatRow label="Input" value={formatTokens(stats.tokens.input)} />
            <StatRow label="Output" value={formatTokens(stats.tokens.output)} />
            <StatRow label="Cache read" value={formatTokens(stats.tokens.cacheRead)} />
            <StatRow label="Cache write" value={formatTokens(stats.tokens.cacheWrite)} />
            <SectionLabel>Session</SectionLabel>
            {stats.cost === 0 && hasNoPricing(model) ? (
              <div className="text-text-tertiary flex items-center justify-between gap-3">
                <span>Cost</span>
                <button
                  onClick={() => {
                    setOpen(false)
                    const settingsUi = useSettingsUiStore.getState()
                    settingsUi.setTab('advanced')
                    settingsUi.setOpen(true)
                  }}
                  title={`No pricing configured for ${model?.name ?? 'this model'} — add cost rates to models.json`}
                  className="text-warning hover:underline"
                >
                  no pricing configured →
                </button>
              </div>
            ) : (
              <StatRow label="Cost" value={formatCost(stats.cost)} />
            )}
            <StatRow label="Messages" value={String(stats.totalMessages)} />
            <StatRow label="Tool calls" value={String(stats.toolCalls)} />
            <PlanLimits statusText={rateLimitStatus} />
          </div>
        </PopupMenu>
      )}
    </div>
  )
}

/**
 * What is actually filling the window. Absent until the bundled extension
 * reports (first turn of a session), and silently absent if a user runs pi
 * without pidex's extensions — the meter must still work.
 */
function ContextComposition({
  statusText,
  total,
  window,
}: {
  statusText: string | undefined
  total: number
  window: number
}): React.JSX.Element | null {
  const breakdown = parseContextBreakdown(statusText)
  if (!breakdown || window <= 0) return null
  const slices = breakdownSlices(breakdown, total, window)
  if (slices.length <= 1) return null

  return (
    <div className="pt-1.5">
      <div className="bg-bg-secondary flex h-2 overflow-hidden rounded-full">
        {slices.map((slice) => (
          <div
            key={slice.key}
            style={{ width: `${slice.percent}%`, backgroundColor: slice.color }}
            title={`${slice.label}: ${formatTokens(slice.tokens)}`}
          />
        ))}
      </div>
      <div className="mt-1.5 space-y-0.5">
        {slices.map((slice) => (
          <div key={slice.key} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
              aria-hidden
            />
            <span className="text-text-tertiary flex-1 truncate">
              {slice.label}
              {slice.count !== undefined && slice.count > 0 && (
                <span className="text-text-tertiary/70"> · {slice.count}</span>
              )}
            </span>
            <span className="text-text-secondary font-mono text-sm tabular-nums">
              {formatTokens(slice.tokens)}
            </span>
            <span className="text-text-tertiary w-10 text-right font-mono text-sm tabular-nums">
              {slice.percent < 0.1 ? '<0.1' : slice.percent.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      {breakdown.approximate && (
        <div className="text-text-tertiary pt-1 text-sm">
          Component sizes are estimates; the total is pi&apos;s own figure.
        </div>
      )}
    </div>
  )
}

/**
 * Account-level usage window for Claude Code sessions — which window the
 * account is in and when capacity returns. Utilization percentages are not
 * available: the CLI reads them from response headers and never forwards
 * them (see rateLimit.ts).
 */
function PlanLimits({ statusText }: { statusText: string | undefined }): React.JSX.Element | null {
  const limit = parseRateLimit(statusText)
  if (!limit) return null
  const reset = resetLabel(limit.resetsAt)
  const capped = limit.status === 'rejected'

  return (
    <>
      <SectionLabel>Plan limits · Claude Code</SectionLabel>
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-tertiary">{windowLabel(limit.windowType)}</span>
        <span
          className={clsx(
            'font-mono text-sm tabular-nums',
            capped ? 'text-danger' : 'text-text-secondary',
          )}
        >
          {capped ? 'limit reached' : (reset ?? 'active')}
        </span>
      </div>
      {limit.isUsingOverage && (
        <div className="text-warning text-sm">Using extra usage beyond the plan allowance.</div>
      )}
      {capped && reset && <div className="text-text-tertiary text-sm">{reset}.</div>}
    </>
  )
}

function SectionLabel({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="text-text-tertiary pb-0.5 pt-1.5 font-mono text-2xs uppercase tracking-wider first:pt-0">
      {children}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-secondary font-mono text-sm tabular-nums">{value}</span>
    </div>
  )
}
