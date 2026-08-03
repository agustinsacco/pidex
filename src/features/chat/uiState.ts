import { create } from 'zustand'

/** Cross-component chat UI state (fork picker, composer prefill). */
interface ChatUiState {
  forkPickerFor: string | null
  prefill: Record<string, string | undefined>
  openForkPicker: (sessionId: string) => void
  closeForkPicker: () => void
  setPrefill: (sessionId: string, text: string) => void
  consumePrefill: (sessionId: string) => string | undefined
}

export const useChatUiStore = create<ChatUiState>((set, get) => ({
  forkPickerFor: null,
  prefill: {},
  openForkPicker: (sessionId) => set({ forkPickerFor: sessionId }),
  closeForkPicker: () => set({ forkPickerFor: null }),
  setPrefill: (sessionId, text) =>
    set((s) => ({ prefill: { ...s.prefill, [sessionId]: text } })),
  consumePrefill: (sessionId) => {
    const text = get().prefill[sessionId]
    if (text !== undefined) {
      set((s) => ({ prefill: { ...s.prefill, [sessionId]: undefined } }))
    }
    return text
  },
}))
