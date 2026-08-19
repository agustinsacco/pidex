import { create } from 'zustand'
import { useSessionsStore } from './sessions'

export type RightPane = 'files' | 'changes' | 'terminal' | 'artifacts' | null

/** Right-hand pane selection for ONE chat session. */
interface SessionPanes {
  pane: RightPane
  /** Expanded (↗) right pane takes most of the window. */
  expanded: boolean
}

/** Stable empty value so selectors don't allocate a new object per render. */
const CLOSED: SessionPanes = Object.freeze({ pane: null, expanded: false })

/**
 * Pane layout state. Panel sizes persist via react-resizable-panels autoSaveId.
 *
 * The right pane is keyed per session, not global. It used to be global, which
 * meant opening a terminal in one session opened it in every session you
 * switched to — and because the pane auto-spawns a shell on first open, merely
 * visiting another session silently forked a login shell there. Sessions own
 * their terminals (see stores/terminal.ts) and their artifacts, so they have to
 * own the pane that shows them too.
 *
 * Actions take an optional `sessionId` and otherwise resolve the active session
 * themselves, so shortcut/palette/toolbar call sites stay one-liners.
 */
interface LayoutState {
  sidebarVisible: boolean
  /** session id → that session's right-pane selection. */
  bySession: Record<string, SessionPanes>
  toggleSidebar: () => void
  setRightPane: (pane: RightPane, sessionId?: string) => void
  toggleRightPane: (pane: Exclude<RightPane, null>, sessionId?: string) => void
  toggleRightExpanded: (sessionId?: string) => void
  /** Drop a disposed session's pane state so the map doesn't grow forever. */
  removeSession: (sessionId: string) => void
}

/** A session's pane selection; closed for unknown/absent sessions. */
export function sessionPanes(
  state: LayoutState,
  sessionId: string | null | undefined,
): SessionPanes {
  return (sessionId ? state.bySession[sessionId] : undefined) ?? CLOSED
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarVisible: true,
  bySession: {},

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),

  setRightPane: (pane, sessionId) =>
    set((state) => patch(state, sessionId, (current) => ({ ...current, pane }))),

  toggleRightPane: (pane, sessionId) =>
    set((state) =>
      patch(state, sessionId, (current) => ({
        ...current,
        pane: current.pane === pane ? null : pane,
      })),
    ),

  toggleRightExpanded: (sessionId) =>
    set((state) =>
      patch(state, sessionId, (current) => ({ ...current, expanded: !current.expanded })),
    ),

  removeSession: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.bySession)) return state
      const bySession = { ...state.bySession }
      delete bySession[sessionId]
      return { bySession }
    }),
}))

/** Apply a patch to one session's pane slice, defaulting to the active session. */
function patch(
  state: LayoutState,
  sessionId: string | undefined,
  update: (current: SessionPanes) => SessionPanes,
): Partial<LayoutState> {
  const id = sessionId ?? useSessionsStore.getState().activeSessionId
  // No session means no right pane exists to act on (workspace home).
  if (!id) return state
  return { bySession: { ...state.bySession, [id]: update(state.bySession[id] ?? CLOSED) } }
}

/**
 * Active session's pane selection. A plain `useLayoutStore` selector is not
 * enough — the answer also changes when the active session changes.
 */
export function useRightPane(): RightPane {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  return useLayoutStore((s) => sessionPanes(s, activeSessionId).pane)
}

/** Active session's expanded (↗) state. */
export function useRightExpanded(): boolean {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  return useLayoutStore((s) => sessionPanes(s, activeSessionId).expanded)
}

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
