import { useEffect, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels'
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
import { RightPane } from '@/features/files/RightPane'
import { FuzzyFinder, useFinderStore } from '@/features/files/FuzzyFinder'
import { ExtensionDialogHost, ToastHost } from '@/features/extension-ui/ExtensionUiHosts'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { SettingsModal, useSettingsUiStore } from '@/features/settings/SettingsModal'

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

  // Global shortcuts: Cmd/Ctrl+B sidebar, Cmd/Ctrl+N new session, Cmd/Ctrl+P finder.
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
      } else if (event.key === 'p') {
        event.preventDefault()
        if (useWorkspacesStore.getState().currentPath) {
          useFinderStore.getState().setOpen(true)
        }
      } else if (event.key === 'e' && event.shiftKey) {
        event.preventDefault()
        useLayoutStore.getState().toggleRightPane('files')
      } else if (event.key === 'g' && event.shiftKey) {
        event.preventDefault()
        useLayoutStore.getState().toggleRightPane('changes')
      } else if (event.key === '`') {
        event.preventDefault()
        useLayoutStore.getState().toggleRightPane('terminal')
      } else if (event.key === ',') {
        event.preventDefault()
        useSettingsUiStore.getState().setOpen(true)
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
          <MainWithPanes workspacePath={currentWorkspace} activeSessionId={activeSessionId} />
        ) : (
          <WorkspaceHome workspacePath={currentWorkspace} />
        )}
      </main>
      <FuzzyFinder workspacePath={currentWorkspace} />
      <ContextMenuHost />
      <ExtensionDialogHost />
      <ToastHost />
      <CommandPalette workspacePath={currentWorkspace} />
      <SettingsModal />
    </div>
  )
}

function MainWithPanes({
  workspacePath,
  activeSessionId,
}: {
  workspacePath: string
  activeSessionId: string
}): React.JSX.Element {
  const rightPane = useLayoutStore((s) => s.rightPane)
  const rightExpanded = useLayoutStore((s) => s.rightExpanded)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  // Expand (↗) toggles the right panel between its saved size and ~85%.
  useEffect(() => {
    const panel = rightPanelRef.current
    if (!panel || !rightPane) return
    if (rightExpanded) panel.resize(85)
    else panel.resize(45)
  }, [rightExpanded, rightPane])

  return (
    <PanelGroup direction="horizontal" autoSaveId={`pidex-main-${workspacePath}`}>
      <Panel id="chat" order={1} minSize={15}>
        <ChatView key={activeSessionId} sessionId={activeSessionId} workspacePath={workspacePath} />
      </Panel>
      {rightPane && (
        <>
          <PanelResizeHandle className="pane-handle" />
          <Panel ref={rightPanelRef} id="right" order={2} defaultSize={45} minSize={24}>
            <RightPane workspacePath={workspacePath} />
          </Panel>
        </>
      )}
    </PanelGroup>
  )
}
