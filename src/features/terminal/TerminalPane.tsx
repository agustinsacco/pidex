import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useTerminalStore } from '@/stores/terminal'
import { useLayoutStore } from '@/stores/layout'
import { TerminalView } from './TerminalView'

/** Right-side terminal panel: "Terminal +" tabs, expand ↗, close ✕. */
export const TerminalPane = memo(function TerminalPane({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeId = useTerminalStore((s) => s.activeId)
  const rightExpanded = useLayoutStore((s) => s.rightExpanded)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // First open: spawn a shell automatically.
  useEffect(() => {
    if (useTerminalStore.getState().tabs.length === 0) {
      void useTerminalStore.getState().createTab(workspacePath)
    }
  }, [workspacePath])

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <span className="text-[13px] font-semibold">Terminal</span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.ptyId}
              className={clsx(
                'group flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] transition-colors',
                tab.ptyId === activeId
                  ? 'bg-bg-secondary text-text'
                  : 'text-text-tertiary hover:text-text',
                tab.exited && 'opacity-60',
              )}
              onClick={() => useTerminalStore.getState().setActive(tab.ptyId)}
              onDoubleClick={() => {
                setRenaming(tab.ptyId)
                setRenameValue(tab.title)
              }}
            >
              {renaming === tab.ptyId ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim())
                      useTerminalStore.getState().renameTab(tab.ptyId, renameValue.trim())
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="border-border w-24 rounded border bg-transparent px-1 text-[11.5px] outline-none"
                />
              ) : (
                <span>{tab.title}</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void useTerminalStore.getState().closeTab(tab.ptyId)
                }}
                className="text-text-tertiary hover:text-text hidden group-hover:block"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => void useTerminalStore.getState().createTab(workspacePath)}
          title="New terminal"
          className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors"
        >
          +
        </button>
        <button
          onClick={() => useLayoutStore.getState().toggleRightExpanded()}
          title={rightExpanded ? 'Restore pane size' : 'Expand pane'}
          className="text-text-tertiary hover:text-text hover:bg-bg-secondary flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {rightExpanded ? (
              <path d="M10 14 3 21m0-6v6h6M14 10l7-7m-6 0h6v6" />
            ) : (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            )}
          </svg>
        </button>
        <button
          onClick={() => useLayoutStore.getState().setRightPane(null)}
          title="Close terminal pane"
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

      <div className="terminal-surface min-h-0 flex-1 p-1.5">
        {tabs.map((tab) => (
          <TerminalView key={tab.ptyId} ptyId={tab.ptyId} visible={tab.ptyId === activeId} />
        ))}
        {tabs.length === 0 && (
          <div className="text-text-tertiary flex h-full items-center justify-center text-[12.5px]">
            Starting shell…
          </div>
        )}
      </div>
    </div>
  )
})
