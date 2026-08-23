import { handle } from './handle'
import { fleetHub } from '../registry'
import { orchestrator } from '../orchestrator/instance'
import { readRules, rulesPath, writeRules } from '../orchestrator/files'
import { getPrefs } from '../store'
import { DEFAULT_ORCHESTRATOR_PREFS, type OrchestratorWorkspacePrefs } from '@shared/models'

function requireManager(): NonNullable<ReturnType<typeof orchestrator>> {
  const manager = orchestrator()
  if (!manager) throw new Error('Orchestration is not available yet.')
  return manager
}

/**
 * Fleet + orchestrator channels.
 *
 * `fleet:state` is free — it reads the hub's in-memory projection. Everything
 * under `orchestrator:` except `overview` and `rules` may start a process, and
 * only `sweep` spends tokens.
 */
export function registerOrchestratorHandlers(): void {
  handle('fleet:state', () => fleetHub.snapshot())

  handle('orchestrator:ensure', (_event, workspacePath: string) =>
    requireManager().ensure(workspacePath),
  )

  handle('orchestrator:sweep', (_event, workspacePath: string, kind) =>
    requireManager().sweep(workspacePath, kind),
  )

  handle('orchestrator:rules', async (_event, workspacePath: string) => {
    const { content, exists } = await readRules(workspacePath)
    return { path: rulesPath(workspacePath), content, exists }
  })

  handle('orchestrator:writeRules', (_event, workspacePath: string, content: string) =>
    writeRules(workspacePath, content),
  )

  handle('orchestrator:overview', () => {
    const prefs = getPrefs()
    const withDefaults: Record<string, OrchestratorWorkspacePrefs> = {}
    for (const [path, value] of Object.entries(prefs.orchestrator)) {
      withDefaults[path] = { ...DEFAULT_ORCHESTRATOR_PREFS, ...value }
    }
    return {
      digests: prefs.orchestratorDigests,
      prefs: withDefaults,
      sessions: prefs.orchestratorSessions,
    }
  })

  handle('orchestrator:setPrefs', (_event, workspacePath: string, value) => {
    requireManager().setPrefs(workspacePath, value)
  })

  handle('orchestrator:acceptProposal', async (_event, workspacePath: string, prompt: string) => {
    // Accepting a suggestion is the user starting work, so it bypasses the
    // autopilot cap entirely — that cap governs what the agent does unattended.
    const manager = requireManager()
    return manager.startProposedWork(workspacePath, prompt)
  })
}
