import { useState } from 'react'
import clsx from 'clsx'
import { useChatStore } from '@/stores/chat'
import { PopupMenu } from '@/components/PopupMenu'

export function ContextMeter({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const stats = useChatStore((s) => s.sessions[sessionId]?.stats)
  const [open, setOpen] = useState(false)

  const usage = stats?.contextUsage
  if (!stats || !usage || usage.percent == null) return null

  const percent = Math.min(100, Math.round(usage.percent))
  const warn = percent >= 75
  const critical = percent >= 90

  return (
    <div className="relative">
      <button
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
            'text-[11.5px] tabular-nums',
            critical ? 'text-danger' : warn ? 'text-warning' : 'text-text-tertiary',
          )}
        >
          {percent}%
        </span>
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          className="absolute bottom-full right-0 mb-2 w-64 p-3"
        >
          <div className="text-text text-[12.5px] font-medium">Session usage</div>
          <div className="mt-2 space-y-1 text-[12px]">
            <StatRow
              label="Context"
              value={`${formatTokens(usage.tokens ?? 0)} / ${formatTokens(usage.contextWindow)} (${percent}%)`}
            />
            <StatRow label="Input tokens" value={formatTokens(stats.tokens.input)} />
            <StatRow label="Output tokens" value={formatTokens(stats.tokens.output)} />
            <StatRow label="Cache read" value={formatTokens(stats.tokens.cacheRead)} />
            <StatRow label="Cache write" value={formatTokens(stats.tokens.cacheWrite)} />
            <div className="border-border my-1.5 border-t" />
            <StatRow label="Cost" value={`$${stats.cost.toFixed(4)}`} />
            <StatRow label="Messages" value={String(stats.totalMessages)} />
            <StatRow label="Tool calls" value={String(stats.toolCalls)} />
          </div>
        </PopupMenu>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-secondary font-mono text-[11.5px] tabular-nums">{value}</span>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}
