import { create } from 'zustand'

/**
 * Pane layout state. P0 keeps only skeleton flags; the resizable pane system
 * arrives in P3 and persists per-workspace layout via app prefs.
 */
interface LayoutState {
  sidebarVisible: boolean
  filesPaneVisible: boolean
  terminalPaneVisible: boolean
  artifactsPaneVisible: boolean
  toggleSidebar: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarVisible: true,
  filesPaneVisible: false,
  terminalPaneVisible: false,
  artifactsPaneVisible: false,
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
}))
