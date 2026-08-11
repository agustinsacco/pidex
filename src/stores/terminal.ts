import { create } from 'zustand'
import { useLayoutStore } from './layout'
import { useSessionsStore } from './sessions'

export interface TerminalTab {
  ptyId: string
  title: string
  exited: boolean
  /** A foreground process (npm, vim, …) is running in this shell. */
  running: boolean
}

/**
 * Terminals for ONE session, mirroring how artifacts are scoped: each chat
 * session owns its shells (spawned in the session's cwd, which for worktree
 * sessions is the worktree). Switching sessions swaps which set is shown
 * without killing the PTYs; disposing the session kills them.
 */
interface SessionTerminals {
  tabs: TerminalTab[]
  activeId: string | null
}

/** Stable empty value so selectors don't allocate a new object per render. */
const EMPTY_TERMINALS: SessionTerminals = Object.freeze({ tabs: [], activeId: null })

interface TerminalState {
  /** pidex session id → that session's terminal tabs. */
  bySession: Record<string, SessionTerminals>
  /** Text waiting to be pasted into the active terminal once it exists. */
  pendingPaste: string | null

  createTab: (sessionId: string, cwd: string) => Promise<string>
  closeTab: (sessionId: string, ptyId: string) => Promise<void>
  renameTab: (sessionId: string, ptyId: string, title: string) => void
  setActive: (sessionId: string, ptyId: string) => void
  /** ptyIds are globally unique, so exit/status updates locate their owner. */
  markExited: (ptyId: string) => void
  applyStatus: (statuses: Record<string, boolean>) => void
  /** Kill every PTY belonging to a disposed session and drop its state. */
  removeSession: (sessionId: string) => Promise<void>
  queuePaste: (text: string) => void
  consumePaste: () => string | null
}

/** Terminals for a session; stable empty value avoids per-render allocation. */
export function sessionTerminals(state: TerminalState, sessionId: string): SessionTerminals {
  return state.bySession[sessionId] ?? EMPTY_TERMINALS
}

/** Apply a patch to one session's terminal slice. */
function patchSession(
  state: TerminalState,
  sessionId: string,
  update: (current: SessionTerminals) => SessionTerminals,
): Pick<TerminalState, 'bySession'> {
  const current = state.bySession[sessionId] ?? EMPTY_TERMINALS
  return { bySession: { ...state.bySession, [sessionId]: update(current) } }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  bySession: {},
  pendingPaste: null,

  createTab: async (sessionId, cwd) => {
    // Pass the owning session so main can attribute this shell's process
    // tree (builds, tests, dev servers) to it in the resource monitor.
    const { ptyId } = await window.pidex.invoke('pty:create', cwd, 80, 24, sessionId)
    set((s) =>
      patchSession(s, sessionId, (t) => ({
        tabs: [
          ...t.tabs,
          { ptyId, title: `Terminal ${t.tabs.length + 1}`, exited: false, running: false },
        ],
        activeId: ptyId,
      })),
    )
    return ptyId
  },

  closeTab: async (sessionId, ptyId) => {
    await window.pidex.invoke('pty:kill', ptyId)
    set((s) =>
      patchSession(s, sessionId, (t) => {
        const tabs = t.tabs.filter((tab) => tab.ptyId !== ptyId)
        return {
          tabs,
          activeId: t.activeId === ptyId ? (tabs[tabs.length - 1]?.ptyId ?? null) : t.activeId,
        }
      }),
    )
  },

  renameTab: (sessionId, ptyId, title) =>
    set((s) =>
      patchSession(s, sessionId, (t) => ({
        ...t,
        tabs: t.tabs.map((tab) => (tab.ptyId === ptyId ? { ...tab, title } : tab)),
      })),
    ),

  setActive: (sessionId, ptyId) =>
    set((s) => patchSession(s, sessionId, (t) => ({ ...t, activeId: ptyId }))),

  markExited: (ptyId) =>
    set((s) => ({
      bySession: Object.fromEntries(
        Object.entries(s.bySession).map(([sessionId, t]) => [
          sessionId,
          t.tabs.some((tab) => tab.ptyId === ptyId)
            ? {
                ...t,
                tabs: t.tabs.map((tab) =>
                  tab.ptyId === ptyId ? { ...tab, exited: true, running: false } : tab,
                ),
              }
            : t,
        ]),
      ),
    })),

  applyStatus: (statuses) =>
    set((s) => ({
      bySession: Object.fromEntries(
        Object.entries(s.bySession).map(([sessionId, t]) => [
          sessionId,
          t.tabs.some((tab) => statuses[tab.ptyId] !== undefined)
            ? {
                ...t,
                tabs: t.tabs.map((tab) =>
                  statuses[tab.ptyId] !== undefined && tab.running !== statuses[tab.ptyId]
                    ? { ...tab, running: statuses[tab.ptyId] ?? false }
                    : tab,
                ),
              }
            : t,
        ]),
      ),
    })),

  removeSession: async (sessionId) => {
    const tabs = get().bySession[sessionId]?.tabs ?? []
    await Promise.allSettled(tabs.map((tab) => window.pidex.invoke('pty:kill', tab.ptyId)))
    set((s) => {
      const bySession = { ...s.bySession }
      delete bySession[sessionId]
      return { bySession }
    })
  },

  queuePaste: (text) => set({ pendingPaste: text }),
  consumePaste: () => {
    const text = get().pendingPaste
    if (text !== null) set({ pendingPaste: null })
    return text
  },
}))

/** Count of terminals with a running foreground process, for badges. */
export function runningCount(state: TerminalState, sessionId: string): number {
  return sessionTerminals(state, sessionId).tabs.filter((t) => t.running && !t.exited).length
}

/**
 * "Run in terminal" from chat code blocks: open the terminal pane, ensure the
 * active session has a tab, and paste the command. The signature keeps
 * `workspacePath` as the spawn cwd fallback; the owning session is the active
 * one (both callers live in the active chat).
 *
 * Pasting does NOT execute by default — a code block the model wrote is the
 * user's call to review and run. `execute: true` is for commands pidex itself
 * proposes (a known remediation with a play button), where the click IS the
 * confirmation.
 */
export async function runInTerminal(
  workspacePath: string,
  command: string,
  options: { execute?: boolean } = {},
): Promise<void> {
  const sessions = useSessionsStore.getState()
  const sessionId = sessions.activeSessionId
  if (!sessionId) return
  const cwd = sessions.live[sessionId]?.workspacePath || workspacePath
  useLayoutStore.getState().setRightPane('terminal')
  const store = useTerminalStore.getState()
  if (!sessionTerminals(store, sessionId).activeId) {
    await store.createTab(sessionId, cwd)
  }
  useTerminalStore.getState().queuePaste(options.execute ? `${command}\n` : command)
}
