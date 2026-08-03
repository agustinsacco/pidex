import { memo } from 'react'
import { useLayoutStore } from '@/stores/layout'

/**
 * Shared chrome for every right-hand pane (Files, Changes, Terminal,
 * Artifacts).
 *
 * Before this, Files/Changes shared a tabbed header while Terminal and
 * Artifacts each rendered their own, so header height and the placement of
 * expand/close shifted depending on which pane was open. The reference keeps
 * one shell: title left, pane-specific actions in the middle, then ↗ expand
 * and ✕ close always at the far right.
 */
export const PaneShell = memo(function PaneShell({
  title,
  actions,
  children,
}: {
  title: React.ReactNode
  /** Pane-specific controls, rendered between the title and ↗ / ✕. */
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const expanded = useLayoutStore((s) => s.rightExpanded)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex h-11 shrink-0 items-center gap-1.5 border-b px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{title}</div>
        {actions}
        <PaneIconButton
          title={expanded ? 'Restore pane size' : 'Expand pane'}
          onClick={() => useLayoutStore.getState().toggleRightExpanded()}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {expanded ? (
              <path d="M10 14 3 21m0-6v6h6M14 10l7-7m-6 0h6v6" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
        </PaneIconButton>
        <PaneIconButton
          title="Close pane"
          onClick={() => useLayoutStore.getState().setRightPane(null)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </PaneIconButton>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
})

/** Square icon button sized to match the shell header. */
export function PaneIconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
    >
      {children}
    </button>
  )
}

/** Pane title: bold label plus optional trailing meta. */
export function PaneTitle({
  label,
  meta,
}: {
  label: string
  meta?: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <span className="shrink-0 text-[13px] font-semibold">{label}</span>
      {meta && <span className="text-text-tertiary min-w-0 truncate text-[11.5px]">{meta}</span>}
    </>
  )
}
