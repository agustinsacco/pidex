import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/models'
import { useSessionsStore } from './sessions'

/**
 * Known workspaces, plus the folder the **home screen** is composing against.
 *
 * Deliberately NOT an app-wide "current workspace": once a session is open,
 * the answer to "which folder am I in?" is that session's own
 * `workspacePath` (sessions can span several projects at once). This store
 * only owns the list and the home-screen target — use `useActiveWorkspace()`
 * for the derived answer.
 */
interface WorkspacesState {
  /** Folder the home screen composes against when no session is active. */
  homePath: string | null
  recents: WorkspaceInfo[]
  /** Point the home screen at a workspace (adds it to recents if new). */
  openWorkspace: (path: string) => void
  /** Native folder picker; adds the chosen folder rather than replacing. */
  pickAndOpen: () => Promise<string | null>
  hydrate: () => Promise<void>
}

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  homePath: null,
  recents: [],

  openWorkspace: (path) => {
    set((s) => {
      if (s.recents.some((w) => w.path === path)) return { homePath: path }
      const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path
      return {
        homePath: path,
        recents: [{ path, name, lastOpenedAt: Date.now() }, ...s.recents],
      }
    })
  },

  pickAndOpen: async () => {
    const path = await window.pidex.invoke('app:selectFolder')
    if (path) get().openWorkspace(path)
    return path
  },

  hydrate: async () => {
    const prefs = await window.pidex.invoke('app:getPrefs')
    set({ recents: prefs.recentWorkspaces })
  },
}))

/**
 * The workspace the UI should act on: the active session's folder, or the
 * home-screen target when no session is open.
 *
 * Hook form for components; `getActiveWorkspace()` for imperative callers.
 */
export function useActiveWorkspace(): string | null {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const sessionWorkspace = useSessionsStore((s) =>
    s.activeSessionId ? (s.live[s.activeSessionId]?.workspacePath ?? null) : null,
  )
  const homePath = useWorkspacesStore((s) => s.homePath)
  return activeSessionId ? sessionWorkspace : homePath
}

export function getActiveWorkspace(): string | null {
  const { activeSessionId, live } = useSessionsStore.getState()
  if (activeSessionId) return live[activeSessionId]?.workspacePath ?? null
  return useWorkspacesStore.getState().homePath
}
