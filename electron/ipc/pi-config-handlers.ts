import { handle } from './handle'
import {
  checkAgentSettings,
  listCatalogueModels,
  listPiResources,
  patchAgentSettings,
  readAgentSettings,
  readConfigFile,
  writeConfigFile,
} from '../pi/agent-settings'
import { resolveCatalogueModels } from '../pi/model-catalogue'
import { checkPiHealth } from '../pi/health'
import { type ConfigFileHealth } from '@shared/models'

/** Reading and patching pi's own agent settings files. */
export function registerPiConfigHandlers(): void {
  handle('pi:agentSettings', (_event, workspacePath?: string) => readAgentSettings(workspacePath))

  // Ask a throwaway pi RPC process for its full catalogue (built-ins +
  // models.json, with real display names and thinkingLevelMap — see
  // model-catalogue.ts), falling back to parsing models.json directly when
  // pi can't be run.
  handle('pi:catalogueModels', () =>
    resolveCatalogueModels(async () => {
      const health = await checkPiHealth()
      return health.ok ? (health.binaryPath ?? null) : null
    }, listCatalogueModels),
  )

  handle('pi:readConfigFile', (_event, name) => readConfigFile(name))

  handle('pi:writeConfigFile', (_event, name, content) => writeConfigFile(name, content))

  handle('pi:patchAgentSettings', (_event, scope, workspacePath, patch) =>
    patchAgentSettings(scope, workspacePath, patch),
  )

  handle('pi:checkAgentSettings', async (_event, workspacePath?: string) => {
    const result = await checkAgentSettings(workspacePath)
    // Don't ship parsed contents over IPC — only the health of each file.
    const strip = (r: ConfigFileHealth | null): ConfigFileHealth | null =>
      r ? { exists: r.exists, malformed: r.malformed, error: r.error } : null
    return { global: strip(result.global)!, project: strip(result.project) }
  })

  handle('pi:listResources', () => listPiResources())
}
