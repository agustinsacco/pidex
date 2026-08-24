import { fleetHub, registry } from '../registry'
import { OrchestratorManager, type OrchestratorSpawnDeps } from './manager'

/**
 * The one orchestrator manager, configured late.
 *
 * Same idiom as `configureMonitor`: spawning a session is implemented in
 * `pi-session-handlers.ts`, so that module injects the capability rather than
 * this one importing it — otherwise the two would import each other.
 */
let manager: OrchestratorManager | null = null

export function configureOrchestrator(deps: OrchestratorSpawnDeps): OrchestratorManager {
  manager = new OrchestratorManager(registry, fleetHub, deps)
  return manager
}

/** Null until `configureOrchestrator` runs, so callers can degrade quietly. */
export function orchestrator(): OrchestratorManager | null {
  return manager
}
