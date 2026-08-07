import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { piAgentDir } from './pi-paths'
import { type CatalogueModel } from './model-catalogue'

export interface PiAgentSettings {
  hideThinkingBlock?: boolean
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  theme?: string
  [key: string]: unknown
}

/**
 * Result of reading one config file. `malformed` distinguishes "the file is
 * there but we could not parse it" from "there is no file" — the difference
 * matters before writing, because merging a patch onto a failed read would
 * silently discard everything the user had configured.
 */
interface ReadResult {
  settings: PiAgentSettings
  exists: boolean
  malformed: boolean
  error?: string
}

/**
 * Read pi's settings.json (global, merged with the workspace override).
 * Unparseable files degrade to empty for display, but `malformed` is
 * reported so callers can refuse to write over them.
 */
export async function readAgentSettings(workspacePath?: string): Promise<PiAgentSettings> {
  const global = await readJson(join(piAgentDir(), 'settings.json'))
  const project = workspacePath
    ? await readJson(join(workspacePath, '.pi', 'settings.json'))
    : { settings: {}, exists: false, malformed: false }
  return { ...global.settings, ...project.settings }
}

/** Read + report whether either scope's file is currently unparseable. */
export async function checkAgentSettings(
  workspacePath?: string,
): Promise<{ global: ReadResult; project: ReadResult | null }> {
  const global = await readJson(join(piAgentDir(), 'settings.json'))
  const project = workspacePath ? await readJson(join(workspacePath, '.pi', 'settings.json')) : null
  return { global, project }
}

async function readJson(path: string): Promise<ReadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // No file yet — writing a fresh one is safe.
    return { settings: {}, exists: false, malformed: false }
  }
  if (raw.trim().length === 0) {
    return { settings: {}, exists: true, malformed: false }
  }
  try {
    return { settings: JSON.parse(raw) as PiAgentSettings, exists: true, malformed: false }
  } catch (error) {
    return { settings: {}, exists: true, malformed: true, error: (error as Error).message }
  }
}

/** Raw config file access for the Advanced tab. Never exposes auth.json. */
export async function readConfigFile(
  name: 'settings' | 'models',
): Promise<{ path: string; content: string }> {
  const path = join(piAgentDir(), `${name}.json`)
  try {
    return { path, content: await readFile(path, 'utf8') }
  } catch {
    return { path, content: '' }
  }
}

export async function writeConfigFile(name: 'settings' | 'models', content: string): Promise<void> {
  // Must be valid JSON — refuse to write broken config.
  JSON.parse(content)
  const dir = piAgentDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.json`), content, 'utf8')
}

/**
 * Merge a patch into pi's settings.json (global or workspace override).
 *
 * Refuses to write when the existing file is present but unparseable: a
 * merge onto a failed read would drop every key the user already had
 * (defaultProvider, packages[], …). The caller surfaces the error and points
 * the user at the raw editor in Advanced.
 */
export async function patchAgentSettings(
  scope: 'global' | 'project',
  workspacePath: string | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  const dir = scope === 'global' ? piAgentDir() : join(workspacePath ?? '', '.pi')
  const path = join(dir, 'settings.json')
  const read = await readJson(path)

  if (read.malformed) {
    throw new Error(
      `${path} is not valid JSON (${read.error ?? 'parse error'}). ` +
        'pidex will not overwrite it and lose your existing settings — ' +
        'fix it in Settings → Advanced → pi settings.json, then try again.',
    )
  }

  const current = read.settings
  const merged: Record<string, unknown> = { ...current, ...patch }
  // Nested objects (compaction/retry) merge one level deep.
  for (const key of ['compaction', 'retry'] as const) {
    if (
      patch[key] &&
      typeof patch[key] === 'object' &&
      current[key] &&
      typeof current[key] === 'object'
    ) {
      merged[key] = { ...(current[key] as object), ...(patch[key] as object) }
    }
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

/** One selectable model, as recorded in pi's models.json. */
export type { CatalogueModel } from './model-catalogue'

/**
 * models.json-only view: what the *user* declared in pi's config.
 *
 * This misses pi's built-in providers, so it is the fallback rather than the
 * primary source — see `resolveCatalogueModels()` in model-catalogue.ts, which
 * prefers `pi --list-models`. Kept separate so it stays hermetically testable
 * against a fixture models.json, with no dependency on a pi binary.
 *
 * `reasoning` comes from the provider's `compat.supportsReasoningEffort`,
 * defaulting to true, because models.json carries no per-model signal.
 */
export async function listCatalogueModels(): Promise<CatalogueModel[]> {
  const read = await readJson(join(piAgentDir(), 'models.json'))
  const providers = read.settings.providers
  if (!providers || typeof providers !== 'object') return []

  const models: CatalogueModel[] = []
  for (const [provider, config] of Object.entries(providers as Record<string, unknown>)) {
    if (!config || typeof config !== 'object') continue
    const { models: list, compat } = config as {
      models?: unknown
      compat?: { supportsReasoningEffort?: boolean }
    }
    if (!Array.isArray(list)) continue
    const reasoning = compat?.supportsReasoningEffort !== false
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const { id, name } = entry as { id?: unknown; name?: unknown }
      if (typeof id !== 'string' || id.length === 0) continue
      models.push({
        id,
        name: typeof name === 'string' && name ? name : id,
        provider,
        reasoning,
      })
    }
  }
  return models
}

/** Discovered pi resources for the read-only Advanced viewer. */
export async function listPiResources(): Promise<{
  skills: string[]
  extensions: string[]
  prompts: string[]
}> {
  const base = piAgentDir()
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
