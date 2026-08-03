import { create } from 'zustand'
import { useLayoutStore } from './layout'

export interface TerminalTab {
  ptyId: string
  title: string
  exited: boolean
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  /** Text waiting to be pasted into the active terminal once it exists. */
  pendingPaste: string | null

  createTab: (workspacePath: string) => Promise<string>
  closeTab: (ptyId: string) => Promise<void>
  renameTab: (ptyId: string, title: string) => void
  setActive: (ptyId: string) => void
  markExited: (ptyId: string) => void
  queuePaste: (text: string) => void
  consumePaste: () => string | null
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeId: null,
  pendingPaste: null,

  createTab: async (workspacePath) => {
    const { ptyId } = await window.pidex.invoke('pty:create', workspacePath, 80, 24)
    const index = get().tabs.length + 1
    set((s) => ({
      tabs: [...s.tabs, { ptyId, title: `Terminal ${index}`, exited: false }],
      activeId: ptyId,
    }))
    return ptyId
  },

  closeTab: async (ptyId) => {
    await window.pidex.invoke('pty:kill', ptyId)
    set((s) => {
      const tabs = s.tabs.filter((t) => t.ptyId !== ptyId)
      return {
        tabs,
        activeId: s.activeId === ptyId ? (tabs[tabs.length - 1]?.ptyId ?? null) : s.activeId,
      }
    })
  },

  renameTab: (ptyId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.ptyId === ptyId ? { ...t, title } : t)),
    })),

  setActive: (ptyId) => set({ activeId: ptyId }),

  markExited: (ptyId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.ptyId === ptyId ? { ...t, exited: true } : t)),
    })),

  queuePaste: (text) => set({ pendingPaste: text }),
  consumePaste: () => {
    const text = get().pendingPaste
    if (text !== null) set({ pendingPaste: null })
    return text
  },
}))

/**
 * "Run in terminal" from chat code blocks: open the terminal pane, ensure a
 * tab exists, and paste the command (no trailing newline — the user executes).
 */
export async function runInTerminal(workspacePath: string, command: string): Promise<void> {
  useLayoutStore.getState().setRightPane('terminal')
  const store = useTerminalStore.getState()
  if (!store.activeId) {
    await store.createTab(workspacePath)
  }
  useTerminalStore.getState().queuePaste(command)
}
