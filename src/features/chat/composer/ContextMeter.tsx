import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useChatStore } from '@/stores/chat'
import { PopupMenu } from '@/components/PopupMenu'
import { formatCost, formatTokens } from '@/lib/format'
import { hasNoPricing } from './pricing'
import { useSettingsUiStore } from '@/features/settings/settingsUiStore'

export function ContextMeter({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const stats = useChatStore((s) => s.sessions[sessionId]?.stats)
  const model = useChatStore((s) => s.sessions[sessionId]?.meta?.model)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const usage = stats?.contextUsage
  if (!stats || !usage || usage.percent == null) return null

  const percent = Math.min(100, Math.round(usage.percent))
  const warn = percent >= 75
  const critical = percent >= 90

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
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute bottom-full right-0 mb-2 w-64 p-3"
        >
          <div className="text-text text-base font-medium">Session usage</div>
          <div className="mt-2 space-y-1 text-base">
            <SectionLabel>Context</SectionLabel>
            <StatRow
              label="Window"
              value={`${formatTokens(usage.tokens ?? 0)} / ${formatTokens(usage.contextWindow)} (${percent}%)`}
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
          </div>
        </PopupMenu>
      )}
    </div>
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
