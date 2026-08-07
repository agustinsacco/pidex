import { memo, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTerminalStore, workspaceTerminals } from '@/stores/terminal'
import { PaneIconButton, PaneShell, PaneTitle } from '@/components/PaneShell'
import { TerminalView } from './TerminalView'
import { CloseIcon } from '@/components/icons'

/** Terminal pane: tab strip in the shell title, "+" as a pane action. */
export const TerminalPane = memo(function TerminalPane({
  workspacePath,
}: {
  workspacePath: string
}): React.JSX.Element {
  const tabs = useTerminalStore((s) => workspaceTerminals(s, workspacePath).tabs)
  const activeId = useTerminalStore((s) => workspaceTerminals(s, workspacePath).activeId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // First open: spawn a shell automatically.
  //
  // createTab is async, so a plain `tabs.length === 0` guard is not enough:
  // StrictMode double-invokes this effect and both passes observe the empty
  // list before the first spawn resolves, producing two shells. A synchronous
  // ref latch makes the check race-free.
  const spawnRequested = useRef(false)
  useEffect(() => {
    if (spawnRequested.current) return
    if (workspaceTerminals(useTerminalStore.getState(), workspacePath).tabs.length > 0) return
    spawnRequested.current = true
    void useTerminalStore.getState().createTab(workspacePath)
  }, [workspacePath])

  return (
    <PaneShell
      title={
        <>
          <PaneTitle label="Terminal" />
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
                onClick={() => useTerminalStore.getState().setActive(workspacePath, tab.ptyId)}
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
                        useTerminalStore
                          .getState()
                          .renameTab(workspacePath, tab.ptyId, renameValue.trim())
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
                    void useTerminalStore.getState().closeTab(workspacePath, tab.ptyId)
                  }}
                  className="text-text-tertiary hover:text-text hidden group-hover:block"
                >
                  <CloseIcon size={9} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        </>
      }
      actions={
        <PaneIconButton
          title="New terminal"
          onClick={() => void useTerminalStore.getState().createTab(workspacePath)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </PaneIconButton>
      }
    >
      <div className="terminal-surface min-h-0 flex-1 p-1.5">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.ptyId}
            ptyId={tab.ptyId}
            visible={tab.ptyId === activeId}
            workspacePath={workspacePath}
          />
        ))}
        {tabs.length === 0 && (
          <div className="text-text-tertiary flex h-full items-center justify-center text-[12.5px]">
            Starting shell…
          </div>
        )}
      </div>
    </PaneShell>
  )
})
