import clsx from 'clsx'
import type { BashItem } from '../reducer'

/** A `!`/`!!` bash execution the user ran from the composer. */

export function BashExecution({ item }: { item: BashItem }): React.JSX.Element {
  return (
    <div className="border-border bg-surface overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <code className="text-text flex-1 truncate font-mono text-[12px]">
          <span className="text-accent font-semibold">!</span> {item.command}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          {item.excludeFromContext && (
            <span className="bg-bg-secondary text-text-tertiary rounded px-1.5 py-px text-[10.5px]">
              not sent to model
            </span>
          )}
          {item.running ? (
            <span className="text-text-tertiary text-[11px]">running…</span>
          ) : (
            <span
              className={clsx(
                'rounded px-1.5 py-px font-mono text-[10.5px] font-medium',
                item.exitCode === 0 ? 'bg-success/15 text-success' : 'bg-danger-soft text-danger',
              )}
            >
              exit {item.exitCode ?? '?'}
            </span>
          )}
        </div>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
        {item.output || (item.running ? '…' : '(no output)')}
      </pre>
      {item.truncated && item.fullOutputPath && (
        <div className="border-border text-text-tertiary border-t px-3 py-1.5 text-[11px]">
          Truncated — full output at <code className="font-mono">{item.fullOutputPath}</code>
        </div>
      )}
    </div>
  )
}
