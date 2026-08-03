import { create } from 'zustand'

export type RightPane = 'files' | 'changes' | 'terminal' | 'artifacts' | null

/** Pane layout state. Panel sizes persist via react-resizable-panels autoSaveId. */
interface LayoutState {
  sidebarVisible: boolean
  rightPane: RightPane
  /** Expanded (↗) right pane takes most of the window. */
  rightExpanded: boolean
  toggleSidebar: () => void
  setRightPane: (pane: RightPane) => void
  toggleRightPane: (pane: Exclude<RightPane, null>) => void
  toggleRightExpanded: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarVisible: true,
  rightPane: null,
  rightExpanded: false,
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setRightPane: (pane) => set({ rightPane: pane }),
  toggleRightPane: (pane) =>
    set((state) => ({ rightPane: state.rightPane === pane ? null : pane })),
  toggleRightExpanded: () => set((state) => ({ rightExpanded: !state.rightExpanded })),
}))

/** Open a file from anywhere (chat chips, diffs, finder) into the Files pane. */
export async function openFileInWorkspace(
  workspacePath: string,
  path: string,
  line?: number,
): Promise<void> {
  const { useFilesStore } = await import('./files')
  useLayoutStore.getState().setRightPane('files')
  const absolute = path.startsWith('/') ? path : `${workspacePath}/${path}`
  await useFilesStore.getState().openFile(workspacePath, absolute, line)
}
