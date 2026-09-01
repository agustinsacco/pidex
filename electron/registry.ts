import { SessionRegistry } from './pi/session-registry'
import { FleetHub } from './orchestrator/fleet'
import { SessionReaper } from './pi/session-reaper'
import { getPrefs } from './store'
import { ptyManager } from './pty/pty-manager'

/**
 * The one live-session registry, shared by the IPC handler modules and by
 * main.ts's shutdown path. Lives outside `ipc.ts` so the per-domain handler
 * modules can reach it without importing their own composition root.
 */
export const registry = new SessionRegistry()

/**
 * The fleet hub observes every session the registry creates. It is passive —
 * no inference, no spawning — so it is safe to start unconditionally.
 */
export const fleetHub = new FleetHub(registry)

/**
 * The idle-session reaper consumes the hub's state and disposes through the
 * registry — policy only, no bookkeeping of its own. Wired here so both the
 * IPC handlers (active-session reports) and main.ts (start) reach the same
 * instance. Prefs are read per sweep, so a settings change applies without a
 * restart.
 */
export const sessionReaper = new SessionReaper(registry, fleetHub, {
  prefs: () => getPrefs().sessionReaper,
  hasLivePtys: (sessionId) => ptyManager.hasLiveForSession(sessionId),
})
