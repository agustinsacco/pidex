import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PiAgentSettings {
  hideThinkingBlock?: boolean
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  theme?: string
  [key: string]: unknown
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

/**
 * Read pi's settings.json (global, merged with the workspace override).
 * Read-only here; explicit editing UI lands in P6 settings.
 */
export async function readAgentSettings(workspacePath?: string): Promise<PiAgentSettings> {
  const global = await readJson(join(agentDir(), 'settings.json'))
  const project = workspacePath
    ? await readJson(join(workspacePath, '.pi', 'settings.json'))
    : {}
  return { ...global, ...project }
}

async function readJson(path: string): Promise<PiAgentSettings> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PiAgentSettings
  } catch {
    return {}
  }
}
