import { create } from 'zustand'

/** Cross-component chat UI state (fork picker, composer prefill, verbosity). */
interface ChatUiState {
  forkPickerFor: string | null
  prefill: Record<string, string | undefined>
  /**
   * sessionId → "keep every activity group open" (⌃O, Claude Code's verbose
   * toggle). A master switch: while it is on it wins over a group's own
   * collapsed state, and turning it off hands control back to the group.
   */
  verbose: Record<string, boolean>
  openForkPicker: (sessionId: string) => void
  closeForkPicker: () => void
  setPrefill: (sessionId: string, text: string) => void
  consumePrefill: (sessionId: string) => string | undefined
  toggleVerbose: (sessionId: string) => void
}

export const useChatUiStore = create<ChatUiState>((set, get) => ({
  forkPickerFor: null,
  prefill: {},
  verbose: {},
  openForkPicker: (sessionId) => set({ forkPickerFor: sessionId }),
  closeForkPicker: () => set({ forkPickerFor: null }),
  setPrefill: (sessionId, text) => set((s) => ({ prefill: { ...s.prefill, [sessionId]: text } })),
  consumePrefill: (sessionId) => {
    const text = get().prefill[sessionId]
    if (text !== undefined) {
      set((s) => ({ prefill: { ...s.prefill, [sessionId]: undefined } }))
    }
    return text
  },
  toggleVerbose: (sessionId) =>
    set((s) => ({ verbose: { ...s.verbose, [sessionId]: !s.verbose[sessionId] } })),
}))
