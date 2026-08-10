import { useState } from 'react'
import { useWorkspacesStore } from '@/stores/workspaces'

export function WorkspacePicker({ piVersion }: { piVersion?: string }): React.JSX.Element {
  const { recents, pickAndOpen, openWorkspace } = useWorkspacesStore()
  // The native folder dialog takes a beat to appear; without this the button
  // gives no feedback and a second click queues a second dialog.
  const [picking, setPicking] = useState(false)

  const pick = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    try {
      await pickAndOpen()
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar-drag h-10 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 pb-16">
        <div className="text-center">
          <h1 className="text-[30px] font-semibold tracking-tight">What are we building today?</h1>
          <p className="text-text-secondary mt-2 text-sm">
            Open a project folder to start a coding session with pi
            {piVersion ? ` ${piVersion}` : ''}.
          </p>
        </div>

        <button
          onClick={() => void pick()}
          disabled={picking}
          aria-busy={picking}
          className="bg-accent hover:bg-accent-hover text-accent-text rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm transition-colors disabled:opacity-60"
        >
          {picking ? 'Opening…' : 'Open Folder…'}
        </button>

        {recents.length > 0 && (
          <div className="w-full max-w-md">
            <div className="text-text-tertiary mb-2 text-xs font-medium uppercase tracking-wider">
              Recent workspaces
            </div>
            <div className="bg-surface border-border overflow-hidden rounded-lg border">
              {recents.slice(0, 6).map((ws) => (
                <button
                  key={ws.path}
                  onClick={() => openWorkspace(ws.path)}
                  className="hover:bg-bg-secondary border-border flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0"
                >
                  <span className="text-base">📁</span>
                  <span className="flex-1 truncate">
                    <span className="block text-sm font-medium">{ws.name}</span>
                    <span className="text-text-tertiary block truncate text-xs">{ws.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
