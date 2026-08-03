import { useEffect, useState } from 'react'
import type { PiHealth } from '@shared/models'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { useLayoutStore } from '@/stores/layout'
import { PiMissingScreen } from './PiMissingScreen'
import { WorkspacePicker } from './WorkspacePicker'
import { ChatView } from '@/features/chat/ChatView'
import { WorkspaceHome } from '@/features/home/WorkspaceHome'
import { Sidebar } from '@/features/sessions/Sidebar'
import { ContextMenuHost } from '@/components/ContextMenu'

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const currentWorkspace = useWorkspacesStore((s) => s.currentPath)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)

  useEffect(() => {
    void useSettingsStore.getState().hydrate()
    void useWorkspacesStore.getState().hydrate()
    void window.pidex.invoke('pi:health').then(setHealth)
  }, [])

  // Global shortcuts: Cmd/Ctrl+B sidebar, Cmd/Ctrl+N new session.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      if (event.key === 'b') {
        event.preventDefault()
        useLayoutStore.getState().toggleSidebar()
      } else if (event.key === 'n') {
        event.preventDefault()
        useSessionsStore.getState().activate(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Window title: workspace · session.
  useEffect(() => {
    const name = currentWorkspace?.split(/[/\\]/).filter(Boolean).pop()
    document.title = name ? `${name} — pidex` : 'pidex'
  }, [currentWorkspace])

  if (health === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-tertiary animate-pulse text-sm">Checking pi installation…</div>
      </div>
    )
  }

  if (!health.ok) {
    return (
      <PiMissingScreen
        health={health}
        onRetry={() => {
          setHealth(null)
          void window.pidex.invoke('pi:health').then(setHealth)
        }}
      />
    )
  }

  if (!currentWorkspace) {
    return <WorkspacePicker piVersion={health.version} />
  }

  return (
    <div className="flex h-full">
      {sidebarVisible && <Sidebar workspacePath={currentWorkspace} />}
      <main className="min-w-0 flex-1">
        {activeSessionId ? (
          <ChatView key={activeSessionId} sessionId={activeSessionId} workspacePath={currentWorkspace} />
        ) : (
          <WorkspaceHome workspacePath={currentWorkspace} />
        )}
      </main>
      <ContextMenuHost />
    </div>
  )
}
