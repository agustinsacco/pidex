import { create } from 'zustand'
import type {
  FleetSession,
  FleetSnapshot,
  OrchestratorDigest,
  OrchestratorWorkspacePrefs,
} from '@shared/models'
import { DEFAULT_ORCHESTRATOR_PREFS } from '@shared/models'
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
  hydrated: boolean

  hydrate: () => Promise<void>
  subscribe: () => () => void
  prefsFor: (workspacePath: string) => OrchestratorWorkspacePrefs
  setPrefs: (workspacePath: string, prefs: OrchestratorWorkspacePrefs) => Promise<void>
  openOrchestrator: (workspacePath: string) => Promise<string>
  sweep: (workspacePath: string, kind: 'brief' | 'review') => Promise<void>
}

export const useFleetStore = create<FleetState>((set, get) => ({
  sessions: [],
  digests: {},
  prefs: {},
  orchestratorSessions: {},
  liveOrchestrators: {},
  sweeping: [],
  sweepErrors: {},
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
    }))
    return sessionId
  },

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
