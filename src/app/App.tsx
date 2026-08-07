import { useEffect, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels'
import type { PiHealth } from '@shared/models'
import { useSettingsStore } from '@/stores/settings'
import { useActiveWorkspace, useWorkspacesStore } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { useLayoutStore } from '@/stores/layout'
import { PiMissingScreen } from './PiMissingScreen'
import { WorkspacePicker } from './WorkspacePicker'
import { ChatView } from '@/features/chat/ChatView'
import { WorkspaceHome } from '@/features/home/WorkspaceHome'
import { Sidebar } from '@/features/sessions/Sidebar'
import { ContextMenuHost } from '@/components/ContextMenu'
import { RightPane } from '@/features/files/RightPane'
import { FuzzyFinder } from '@/features/files/FuzzyFinder'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { ExtensionDialogHost, ToastHost } from '@/features/extension-ui/ExtensionUiHosts'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { workspaceName } from '@/lib/path'

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const currentWorkspace = useActiveWorkspace()
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)

  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    void useSettingsStore.getState().hydrate()
    void useWorkspacesStore.getState().hydrate()
    void window.pidex.invoke('pi:health').then(setHealth)
  }, [])

  // Land where the user left off. Main validates that the workspace and
  // session file still exist, so a deleted folder degrades to the picker
  // instead of routing into a broken screen.
  useEffect(() => {
    if (!health?.ok) return
    let cancelled = false

    void (async () => {
      try {
        const target = await window.pidex.invoke('app:resumeTarget')
        if (cancelled || target.kind === 'none') return

        useWorkspacesStore.getState().openWorkspace(target.workspacePath)
        if (target.kind === 'session' && !cancelled) {
          // Resume by path directly. The session-dir scan is only used to
          // enrich the sidebar; requiring a match there would fail whenever
          // the file lives outside pi's default session directory.
          await useSessionsStore
            .getState()
            .createSession(target.workspacePath, { sessionPath: target.sessionPath })
        }
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [health?.ok])

  useGlobalShortcuts()

  // Window title: workspace · session.
  useEffect(() => {
    const name = currentWorkspace ? workspaceName(currentWorkspace) : undefined
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

  // Hold the picker back until the restore attempt settles, otherwise it
  // flashes for a frame before the previous session loads.
  if (!currentWorkspace) {
    if (restoring) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-text-tertiary animate-pulse text-sm">Restoring your session…</div>
        </div>
      )
    }
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
