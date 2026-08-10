import { create } from 'zustand'

interface UsageUiState {
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * Open/close state for the Usage view. Separate module from the modal
 * component (same rationale as `settingsUiStore`): the sidebar and command
 * palette only need to open it.
 */
export const useUsageUiStore = create<UsageUiState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
