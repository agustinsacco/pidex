import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

/** Raw config file access for the Advanced tab. Never exposes auth.json. */
export async function readConfigFile(
  name: 'settings' | 'models',
): Promise<{ path: string; content: string }> {
  const path = join(agentDir(), `${name}.json`)
  try {
    return { path, content: await readFile(path, 'utf8') }
  } catch {
    return { path, content: '' }
  }
}

export async function writeConfigFile(name: 'settings' | 'models', content: string): Promise<void> {
  // Must be valid JSON — refuse to write broken config.
  JSON.parse(content)
  const dir = agentDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.json`), content, 'utf8')
}

/** Merge a patch into pi's settings.json (global or workspace override). */
export async function patchAgentSettings(
  scope: 'global' | 'project',
  workspacePath: string | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  const dir = scope === 'global' ? agentDir() : join(workspacePath ?? '', '.pi')
  const path = join(dir, 'settings.json')
  const current = await readJson(path)
  const merged = { ...current, ...patch }
  // Nested objects (compaction/retry) merge one level deep.
  for (const key of ['compaction', 'retry'] as const) {
    if (patch[key] && typeof patch[key] === 'object' && current[key] && typeof current[key] === 'object') {
      merged[key] = { ...(current[key] as object), ...(patch[key] as object) }
    }
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

/** Discovered pi resources for the read-only Advanced viewer. */
export async function listPiResources(): Promise<{
  skills: string[]
  extensions: string[]
  prompts: string[]
}> {
  const base = agentDir()
  const list = async (sub: string): Promise<string[]> => {
    try {
      return (await readdir(join(base, sub))).filter((f) => !f.startsWith('.'))
    } catch {
      return []
    }
  }
  return {
    skills: await list('skills'),
    extensions: await list('extensions'),
    prompts: await list('prompts'),
  }
}
