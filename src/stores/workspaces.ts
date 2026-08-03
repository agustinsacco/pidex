import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/models'

interface WorkspacesState {
  currentPath: string | null
  recents: WorkspaceInfo[]
  openWorkspace: (path: string) => void
  pickAndOpen: () => Promise<void>
  hydrate: () => Promise<void>
}

export const useWorkspacesStore = create<WorkspacesState>((set) => ({
  currentPath: null,
  recents: [],

  openWorkspace: (path) => set({ currentPath: path }),

  pickAndOpen: async () => {
    const path = await window.pidex.invoke('app:selectFolder')
    if (path) set({ currentPath: path })
  },

  hydrate: async () => {
    const prefs = await window.pidex.invoke('app:getPrefs')
    set({ recents: prefs.recentWorkspaces })
  },
}))
