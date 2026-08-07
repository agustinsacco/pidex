import { create } from 'zustand'
import { useLayoutStore } from './layout'

interface TerminalTab {
  ptyId: string
  title: string
  exited: boolean
}

/**
 * Terminals for ONE workspace. A shell's cwd is its workspace, so tabs are
 * keyed per workspace: switching sessions swaps which set you see, without
 * killing the PTYs — they keep running in the background.
 */
interface WorkspaceTerminals {
  tabs: TerminalTab[]
  activeId: string | null
}

const EMPTY_TERMINALS: WorkspaceTerminals = { tabs: [], activeId: null }

interface TerminalState {
  /** workspacePath → that workspace's terminal tabs. */
  byWorkspace: Record<string, WorkspaceTerminals>
  /** Text waiting to be pasted into the active terminal once it exists. */
  pendingPaste: string | null

  createTab: (workspacePath: string) => Promise<string>
  closeTab: (workspacePath: string, ptyId: string) => Promise<void>
  renameTab: (workspacePath: string, ptyId: string, title: string) => void
  setActive: (workspacePath: string, ptyId: string) => void
  markExited: (workspacePath: string, ptyId: string) => void
  queuePaste: (text: string) => void
  consumePaste: () => string | null
}

/** Terminals for a workspace; stable empty value avoids per-render allocation. */
export function workspaceTerminals(
  state: TerminalState,
  workspacePath: string,
): WorkspaceTerminals {
  return state.byWorkspace[workspacePath] ?? EMPTY_TERMINALS
}

/** Apply a patch to one workspace's terminal slice. */
function patchWorkspace(
  state: TerminalState,
  workspacePath: string,
  update: (current: WorkspaceTerminals) => WorkspaceTerminals,
): Pick<TerminalState, 'byWorkspace'> {
  const current = state.byWorkspace[workspacePath] ?? EMPTY_TERMINALS
  return { byWorkspace: { ...state.byWorkspace, [workspacePath]: update(current) } }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  byWorkspace: {},
  pendingPaste: null,

  createTab: async (workspacePath) => {
    const { ptyId } = await window.pidex.invoke('pty:create', workspacePath, 80, 24)
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        tabs: [...w.tabs, { ptyId, title: `Terminal ${w.tabs.length + 1}`, exited: false }],
        activeId: ptyId,
      })),
    )
    return ptyId
  },

  closeTab: async (workspacePath, ptyId) => {
    await window.pidex.invoke('pty:kill', ptyId)
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => {
        const tabs = w.tabs.filter((t) => t.ptyId !== ptyId)
        return {
          tabs,
          activeId: w.activeId === ptyId ? (tabs[tabs.length - 1]?.ptyId ?? null) : w.activeId,
        }
      }),
    )
  },

  renameTab: (workspacePath, ptyId, title) =>
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        tabs: w.tabs.map((t) => (t.ptyId === ptyId ? { ...t, title } : t)),
      })),
    ),

  setActive: (workspacePath, ptyId) =>
    set((s) => patchWorkspace(s, workspacePath, (w) => ({ ...w, activeId: ptyId }))),

  markExited: (workspacePath, ptyId) =>
    set((s) =>
      patchWorkspace(s, workspacePath, (w) => ({
        ...w,
        tabs: w.tabs.map((t) => (t.ptyId === ptyId ? { ...t, exited: true } : t)),
      })),
    ),

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
  if (!workspaceTerminals(store, workspacePath).activeId) {
    await store.createTab(workspacePath)
  }
  useTerminalStore.getState().queuePaste(command)
}
