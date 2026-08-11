import { create } from 'zustand'

interface MonitorUiState {
  open: boolean
  /** The floating always-on-top window is open. */
  floating: boolean
  setOpen: (open: boolean) => void
  setFloating: (floating: boolean) => void
  toggleFloating: () => void
}

/**
 * Open/close state for the resource monitor, separate from the panel component
 * (same rationale as `usageUiStore`): the sidebar only needs to open it.
 */
export const useMonitorUiStore = create<MonitorUiState>((set, get) => ({
  open: false,
  floating: false,
  setOpen: (open) => set({ open }),
  setFloating: (floating) => set({ floating }),
  toggleFloating: () => {
    const next = !get().floating
    set({ floating: next })
    void window.pidex.invoke(next ? 'resources:openWindow' : 'resources:closeWindow')
  },
}))
