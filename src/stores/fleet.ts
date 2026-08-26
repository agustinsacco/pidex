import { create } from 'zustand'
import type {
  FleetSession,
  FleetSnapshot,
  OrchestratorDigest,
  OrchestratorWorkspacePrefs,
} from '@shared/models'
import {
  DEFAULT_ORCHESTRATOR_PREFS,
  orchestratorModeOf,
  type OrchestratorMode,
} from '@shared/models'
import { errorText } from '@shared/errors'
import { drop } from './keyedSlice'

/**
 * Projection of the main-process fleet hub.
 *
 * Everything here arrives from main; nothing is computed by asking a model.
 * `digests` are the only model-produced content, and they are pushed only
 * when a sweep publishes one.
 */
interface FleetState {
  sessions: FleetSession[]
  /** Main-repo path → last published digest. */
  digests: Record<string, OrchestratorDigest>
  /** Main-repo path → settings. */
  prefs: Record<string, OrchestratorWorkspacePrefs>
  /** Main-repo path → orchestrator session file path. */
  orchestratorSessions: Record<string, string>
  /** Main-repo path → live orchestrator pidex session id, once opened. */
  liveOrchestrators: Record<string, string>
  /** Sweeps in flight, so the UI can disable their buttons. */
  sweeping: string[]
  /** Main-repo path → why the last sweep failed, if it did. */
  sweepErrors: Record<string, string>
  /**
   * Main-repo path → count of orchestrator messages the user has not seen.
   *
   * The digest's attention count answers a different question ("what needs
   * you?"); this one answers "has it said anything since you looked?", which
   * is what a sidebar badge has to mean.
   */
  unread: Record<string, number>
  hydrated: boolean

  hydrate: () => Promise<void>
  subscribe: () => () => void
  prefsFor: (workspacePath: string) => OrchestratorWorkspacePrefs
  setPrefs: (workspacePath: string, prefs: OrchestratorWorkspacePrefs) => Promise<void>
  openOrchestrator: (workspacePath: string) => Promise<string>
  sweep: (workspacePath: string, kind: 'brief' | 'review') => Promise<void>
  modeFor: (workspacePath: string) => OrchestratorMode
  setMode: (workspacePath: string, mode: OrchestratorMode) => Promise<void>
  /** Abandon the thread and start clean. Returns the new session id. */
  reset: (workspacePath: string) => Promise<string>
  /** Stop the process, keep the thread. */
  restart: (workspacePath: string) => Promise<void>
  noteUnread: (workspacePath: string) => void
  clearUnread: (workspacePath: string) => void
}

export const useFleetStore = create<FleetState>((set, get) => ({
  sessions: [],
  digests: {},
  prefs: {},
  orchestratorSessions: {},
  liveOrchestrators: {},
  sweeping: [],
  sweepErrors: {},
  unread: {},
  hydrated: false,

  hydrate: async () => {
    const [snapshot, overview] = await Promise.all([
      window.pidex.invoke('fleet:state'),
      window.pidex.invoke('orchestrator:overview'),
    ])
    set({
      sessions: snapshot.sessions,
      digests: overview.digests,
      prefs: overview.prefs,
      orchestratorSessions: overview.sessions,
      hydrated: true,
    })
  },

  subscribe: () => {
    const offFleet = window.pidex.onFleetChanged((snapshot: FleetSnapshot) => {
      set({ sessions: snapshot.sessions })
    })
    const offDigest = window.pidex.onOrchestratorDigest((digest) => {
      set((s) => ({ digests: { ...s.digests, [digest.workspacePath]: digest } }))
    })
    return () => {
      offFleet()
      offDigest()
    }
  },

  prefsFor: (workspacePath) => ({
    ...DEFAULT_ORCHESTRATOR_PREFS,
    ...get().prefs[workspacePath],
  }),

  setPrefs: async (workspacePath, prefs) => {
    set((s) => ({ prefs: { ...s.prefs, [workspacePath]: prefs } }))
    await window.pidex.invoke('orchestrator:setPrefs', workspacePath, prefs)
  },

  openOrchestrator: async (workspacePath) => {
    const existing = get().liveOrchestrators[workspacePath]
    if (existing) return existing
    const { sessionId } = await window.pidex.invoke('orchestrator:ensure', workspacePath)
    // Main spawned it, so the renderer has no record of it yet. Without this
    // the session is unrenderable: no transcript, no push subscription, and
    // `useActiveWorkspace()` resolves to null the moment it is activated.
    const { useSessionsStore } = await import('./sessions')
    await useSessionsStore.getState().adoptSession(sessionId, workspacePath)
    set((s) => ({
      liveOrchestrators: { ...s.liveOrchestrators, [workspacePath]: sessionId },
      prefs: {
        ...s.prefs,
        [workspacePath]: { ...get().prefsFor(workspacePath), enabled: true },
      },
      unread: drop(s.unread, workspacePath),
    }))
    return sessionId
  },

  modeFor: (workspacePath) => orchestratorModeOf(get().prefsFor(workspacePath)),

  setMode: async (workspacePath, mode) => {
    // Enforcement is in main and reads prefs per call, so the new mode binds
    // on the orchestrator's very next tool call — no restart needed.
    await get().setPrefs(workspacePath, { ...get().prefsFor(workspacePath), mode })
  },

  reset: async (workspacePath) => {
    const previous = get().liveOrchestrators[workspacePath]
    const { sessionId } = await window.pidex.invoke('orchestrator:reset', workspacePath)
    const { useSessionsStore } = await import('./sessions')
    await useSessionsStore.getState().adoptSession(sessionId, workspacePath)
    set((s) => ({
      liveOrchestrators: { ...s.liveOrchestrators, [workspacePath]: sessionId },
      digests: drop(s.digests, workspacePath),
      orchestratorSessions: drop(s.orchestratorSessions, workspacePath),
      sweepErrors: drop(s.sweepErrors, workspacePath),
      unread: drop(s.unread, workspacePath),
    }))
    // The old live id is gone from main's registry; activating the new one is
    // what the caller does next, so nothing else needs unwinding here.
    void previous
    return sessionId
  },

  restart: async (workspacePath) => {
    await window.pidex.invoke('orchestrator:restart', workspacePath)
    set((s) => ({ liveOrchestrators: drop(s.liveOrchestrators, workspacePath) }))
  },

  noteUnread: (workspacePath) =>
    set((s) => ({
      unread: { ...s.unread, [workspacePath]: (s.unread[workspacePath] ?? 0) + 1 },
    })),

  clearUnread: (workspacePath) => set((s) => ({ unread: drop(s.unread, workspacePath) })),

  sweep: async (workspacePath, kind) => {
    if (get().sweeping.includes(workspacePath)) return
    set((s) => ({
      sweeping: [...s.sweeping, workspacePath],
      sweepErrors: drop(s.sweepErrors, workspacePath),
    }))
    try {
      await window.pidex.invoke('orchestrator:sweep', workspacePath, kind)
    } catch (error) {
      // A sweep can fail for ordinary reasons — the model is unreachable, one
      // is already running, the orchestrator would not spawn. Swallowing it
      // left the button looking pressed and nothing ever happening, which is
      // indistinguishable from a hung app. Say what went wrong.
      set((s) => ({
        sweepErrors: { ...s.sweepErrors, [workspacePath]: errorText(error) },
      }))
    } finally {
      set((s) => ({ sweeping: s.sweeping.filter((p) => p !== workspacePath) }))
    }
  },
}))

/** Live sessions for a project, newest activity first, orchestrator excluded. */
export function workSessionsFor(sessions: FleetSession[], paths: string[]): FleetSession[] {
  const set = new Set(paths)
  return sessions
    .filter((s) => !s.isOrchestrator && set.has(s.workspacePath) && s.phase !== 'exited')
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}
