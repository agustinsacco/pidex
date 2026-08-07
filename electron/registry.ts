import { SessionRegistry } from './pi/session-registry'

/**
 * The one live-session registry, shared by the IPC handler modules and by
 * main.ts's shutdown path. Lives outside `ipc.ts` so the per-domain handler
 * modules can reach it without importing their own composition root.
 */
export const registry = new SessionRegistry()
