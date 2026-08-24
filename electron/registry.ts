import { SessionRegistry } from './pi/session-registry'
import { FleetHub } from './orchestrator/fleet'

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
