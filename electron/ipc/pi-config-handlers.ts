import { handle } from './handle'
import {
  checkAgentSettings,
  listCatalogueModels,
  listPiResources,
  patchAgentSettings,
  patchWebSearchConfig,
  readAgentSettings,
  readAgentSettingsScoped,
  readWebSearchConfig,
  readConfigFile,
  writeConfigFile,
} from '../pi/agent-settings'
import { listModelsViaRpc, resolveCatalogueModels } from '../pi/model-catalogue'
import { checkPiHealth } from '../pi/health'
import { piStubPath } from '../pi/stub'
import { type ConfigFileHealth } from '@shared/models'

/** Reading and patching pi's own agent settings files. */
export function registerPiConfigHandlers(): void {
  handle('pi:agentSettings', (_event, workspacePath?: string) => readAgentSettings(workspacePath))

  handle('pi:agentSettingsScoped', (_event, workspacePath?: string) =>
    readAgentSettingsScoped(workspacePath),
  )

  // Ask a throwaway pi RPC process for its full catalogue (built-ins +
  // models.json, with real display names and thinkingLevelMap — see
  // model-catalogue.ts), falling back to parsing models.json directly when
  // pi can't be run.
  //
  // Honors PIDEX_PI_STUB like every other pi spawn. It did not, and that made
  // it the one hole in the e2e harness: opening a model picker shelled out to
  // the real binary, which boots pi against the sandboxed agent dir and
  // installs whatever `settings.json` declares — a network install, mid-suite,
  // that pruned a fixture package another test had written.
  handle('pi:catalogueModels', () => {
    const stub = piStubPath()
    return resolveCatalogueModels(
      async () => {
        if (stub) return process.execPath
        const health = await checkPiHealth()
        return health.ok ? (health.binaryPath ?? null) : null
      },
      listCatalogueModels,
      stub
        ? (binaryPath) => listModelsViaRpc(binaryPath, [stub])
        : (binaryPath) => listModelsViaRpc(binaryPath),
    )
  })

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

  handle('pi:webSearchConfig', () => readWebSearchConfig())

  handle('pi:patchWebSearchConfig', (_event, patch) => patchWebSearchConfig(patch))
}
