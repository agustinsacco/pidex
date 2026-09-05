import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/models'
import { isWorktreeFolder } from '@/lib/path'
import { useSessionsStore } from './sessions'

/**
 * Known workspaces, plus the folder the **home screen** is composing against.
 *
 * Deliberately NOT an app-wide "current workspace": once a session is open,
 * the answer to "which folder am I in?" is that session's own
 * `workspacePath` (sessions can span several projects at once). This store
 * only owns the list and the home-screen target — use `useActiveWorkspace()`
 * for the derived answer.
 */
interface WorkspacesState {
  /** Folder the home screen composes against when no session is active. */
  homePath: string | null
  recents: WorkspaceInfo[]
  /** Point the home screen at a workspace (adds it to recents if new). */
  openWorkspace: (path: string) => void
  /** Native folder picker; adds the chosen folder rather than replacing. */
  pickAndOpen: () => Promise<string | null>
  /** "No folder": mint a fresh sandbox folder in main and open it. */
  openSandbox: () => Promise<string>
  /** Move a workspace in the user-defined sidebar/switcher order. */
  moveWorkspace: (path: string, direction: 'up' | 'down') => void
  hydrate: () => Promise<void>
}

/** A `WorkspaceInfo` for `path`, its name derived from the basename. */
const entryFor = (path: string): WorkspaceInfo => {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  return { path, name, lastOpenedAt: Date.now() }
}

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  homePath: null,
  recents: [],

  openWorkspace: (path) => {
    // A worktree folder is a *branch* of a workspace, not a workspace of its
    // own. The screen should still point at it (top bar, file tree, home
    // target) — that's `homePath` plus the persisted `lastWorkspacePath` — but
    // it must never enter `recents`, or the sidebar/switcher would list a
    // header per chat instead of one per project.
    set((s) =>
      isWorktreeFolder(path)
        ? { homePath: path, recents: s.recents }
        : {
            homePath: path,
            // Opening records recency for launch recovery, but never changes the
            // user's explicit workspace order. New folders join at the end.
            recents: s.recents.some((w) => w.path === path)
              ? s.recents.map((w) => (w.path === path ? entryFor(path) : w))
              : [...s.recents, entryFor(path)],
          },
    )
    // Persist immediately (recents + lastWorkspacePath). The main process
    // prunes worktree folders from the persisted list; the in-memory list
    // above has already excluded them.
    void window.pidex.invoke('app:recordWorkspace', path)
  },

  pickAndOpen: async () => {
    const path = await window.pidex.invoke('app:selectFolder')
    if (path) get().openWorkspace(path)
    return path
  },

  openSandbox: async () => {
    const path = await window.pidex.invoke('app:createSandbox')
    get().openWorkspace(path)
    return path
  },

  moveWorkspace: (path, direction) => {
    const recents = get().recents
    const index = recents.findIndex((workspace) => workspace.path === path)
    const target = index + (direction === 'up' ? -1 : 1)
    if (index < 0 || target < 0 || target >= recents.length) return

    const next = [...recents]
    const [workspace] = next.splice(index, 1)
    next.splice(target, 0, workspace!)
    set({ recents: next })
    void window.pidex.invoke('app:setRecentWorkspaces', next)
  },

  hydrate: async () => {
    const prefs = await window.pidex.invoke('app:getPrefs')
    set({ recents: prefs.recentWorkspaces })
  },
}))

/**
 * The workspace the UI should act on: the active session's folder, or the
 * home-screen target when no session is open.
 *
 * Hook form for components; `getActiveWorkspace()` for imperative callers.
 */
export function useActiveWorkspace(): string | null {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const sessionWorkspace = useSessionsStore((s) =>
    s.activeSessionId ? (s.live[s.activeSessionId]?.workspacePath ?? null) : null,
  )
  const homePath = useWorkspacesStore((s) => s.homePath)
  return activeSessionId ? sessionWorkspace : homePath
}

export function getActiveWorkspace(): string | null {
  const { activeSessionId, live } = useSessionsStore.getState()
  if (activeSessionId) return live[activeSessionId]?.workspacePath ?? null
  return useWorkspacesStore.getState().homePath
}
