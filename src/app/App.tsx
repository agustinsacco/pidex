import { useEffect, useState } from 'react'
import type { PiHealth } from '@shared/models'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspacesStore } from '@/stores/workspaces'
import { PiMissingScreen } from './PiMissingScreen'
import { WorkspacePicker } from './WorkspacePicker'
import { ChatView } from '@/features/chat/ChatView'

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const currentWorkspace = useWorkspacesStore((s) => s.currentPath)

  useEffect(() => {
    void useSettingsStore.getState().hydrate()
    void useWorkspacesStore.getState().hydrate()
    void window.pidex.invoke('pi:health').then(setHealth)
  }, [])

  if (health === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-tertiary animate-pulse text-sm">Checking pi installation…</div>
      </div>
    )
  }

  if (!health.ok) {
    return <PiMissingScreen health={health} onRetry={() => {
      setHealth(null)
      void window.pidex.invoke('pi:health').then(setHealth)
    }} />
  }

  if (!currentWorkspace) {
    return <WorkspacePicker piVersion={health.version} />
  }

  return <ChatView workspacePath={currentWorkspace} />
}
