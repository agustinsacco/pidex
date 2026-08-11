import { create } from 'zustand'
import type { ResourceSnapshot } from '@shared/models'

/**
 * Resource monitor state.
 *
 * Subscription is reference-counted on BOTH sides: this store counts its own
 * viewers (the modal and the floating window can be open at once) and main
 * counts subscribers, so the `ps` tick stops as soon as the last view closes.
 *
 * History is a bounded ring buffer. A monitor that grows without limit while
 * you watch it would be the exact bug it exists to find.
 */

/** ~2 minutes at the 2s tick. */
export const HISTORY_LIMIT = 60

interface ResourcesState {
  latest: ResourceSnapshot | null
  /** sessionId → recent total RSS (kB) for sparklines, oldest first. */
  historyBySession: Record<string, number[]>
  /** Recent total CPU across all sessions. */
  cpuHistory: number[]
  /** Count terminal process trees toward each session's total. */
  includeTerminals: boolean
  /** Live viewers in THIS renderer. */
  viewers: number

  setIncludeTerminals: (value: boolean) => void
  /** Fold one tick into state. Exported for tests. */
  applySnapshot: (snapshot: ResourceSnapshot) => void
  /** Attach a viewer; returns the detach function. */
  addViewer: () => () => void
}

/** Append to a ring buffer, dropping the oldest beyond the cap. */
export function pushBounded(series: number[], value: number, limit = HISTORY_LIMIT): number[] {
  const next = series.length >= limit ? series.slice(series.length - limit + 1) : series.slice()
  next.push(value)
  return next
}

/** The number a session's row shows, honouring the terminals toggle. */
export function sessionValue(
  snapshot: ResourceSnapshot,
  sessionId: string,
  includeTerminals: boolean,
): { rssKb: number; cpuPercent: number; processCount: number } {
  const session = snapshot.sessions.find((s) => s.sessionId === sessionId)
  if (!session) return { rssKb: 0, cpuPercent: 0, processCount: 0 }
  return includeTerminals ? session.total : session.agent
}

let unsubscribePush: (() => void) | null = null

export const useResourcesStore = create<ResourcesState>((set, get) => ({
  latest: null,
  historyBySession: {},
  cpuHistory: [],
  includeTerminals: true,
  viewers: 0,

  setIncludeTerminals: (value) => set({ includeTerminals: value }),

  applySnapshot: (snapshot) =>
    set((state) => {
      const includeTerminals = state.includeTerminals
      const historyBySession: Record<string, number[]> = {}
      let totalCpu = 0
      for (const session of snapshot.sessions) {
        const usage = includeTerminals ? session.total : session.agent
        totalCpu += usage.cpuPercent
        // Keyed off the NEW snapshot, so a disposed session's history is
        // dropped rather than retained forever.
        historyBySession[session.sessionId] = pushBounded(
          state.historyBySession[session.sessionId] ?? [],
          usage.rssKb,
        )
      }
      return {
        latest: snapshot,
        historyBySession,
        cpuHistory: pushBounded(state.cpuHistory, totalCpu),
      }
    }),

  addViewer: () => {
    const first = get().viewers === 0
    set((s) => ({ viewers: s.viewers + 1 }))

    if (first) {
      unsubscribePush = window.pidex.onResourceSample((snapshot) => {
        useResourcesStore.getState().applySnapshot(snapshot)
      })
      void window.pidex.invoke('resources:subscribe').then((snapshot) => {
        // Main hands back its last sample so the view paints immediately.
        if (snapshot) useResourcesStore.getState().applySnapshot(snapshot)
      })
    }

    let detached = false
    return () => {
      if (detached) return
      detached = true
      const remaining = get().viewers - 1
      set({ viewers: Math.max(0, remaining) })
      if (remaining <= 0) {
        unsubscribePush?.()
        unsubscribePush = null
        void window.pidex.invoke('resources:unsubscribe')
        // Drop history: stale samples would paint a misleading graph when the
        // monitor is reopened minutes later.
        set({ latest: null, historyBySession: {}, cpuHistory: [] })
      }
    }
  },
}))
