import { memo } from 'react'
import clsx from 'clsx'
import { useLayoutStore } from '@/stores/layout'
import { FilesPane } from './FilesPane'
import { FilesChangedPane } from './FilesChangedPane'
import { TerminalPane } from '@/features/terminal/TerminalPane'
import { ArtifactsPane } from '@/features/artifacts/ArtifactsPane'

/** Right-hand region hosting Files / Changes / Terminal (artifacts joins in P5). */
export const RightPane = memo(function RightPane({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element | null {
  const rightPane = useLayoutStore((s) => s.rightPane)
  if (!rightPane) return null

  // Terminal and Artifacts bring their own headers.
  if (rightPane === 'terminal') {
    return (
      <div className="border-border h-full border-l">
        <TerminalPane workspacePath={workspacePath} />
      </div>
    )
  }
  if (rightPane === 'artifacts') {
    return (
      <div className="border-border h-full border-l">
        <ArtifactsPane workspacePath={workspacePath} />
      </div>
    )
  }

  return (
    <div className="border-border flex h-full flex-col border-l">
      <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <PaneTab
          active={rightPane === 'files'}
          onClick={() => useLayoutStore.getState().setRightPane('files')}
        >
          Files
        </PaneTab>
        <PaneTab
          active={rightPane === 'changes'}
          onClick={() => useLayoutStore.getState().setRightPane('changes')}
        >
          Changes
        </PaneTab>
        <div className="flex-1" />
        <button
          onClick={() => useLayoutStore.getState().setRightPane(null)}
          title="Close pane"
          className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md transition-colors"
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
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {rightPane === 'files' ? (
          <FilesPane workspacePath={workspacePath} />
        ) : (
          <FilesChangedPane workspacePath={workspacePath} />
        )}
      </div>
    </div>
  )
})

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
        active ? 'bg-bg-secondary text-text' : 'text-text-tertiary hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
