import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { piProcessEnv } from './shell-env'

const execFileAsync = promisify(execFile)

/** One selectable model, for pickers that have no live pi process to ask. */
export interface CatalogueModel {
  id: string
  name: string
  provider: string
  reasoning: boolean
}

/**
 * The home screen's model list: pi's full catalogue, with a config-only
 * fallback.
 *
 * The session composer asks a live pi process over RPC, which is
 * authoritative. Nothing is running before the first prompt, and the obvious
 * fallback — parsing models.json — only sees providers the *user* declared, so
 * pi's built-in catalogue (every Bedrock, Anthropic, OpenAI… model) was
 * invisible on the home screen. Caching a past session's catalogue cannot fix
 * that either: a brand-new install has no session history to cache.
 *
 * `pi --list-models` resolves it. The CLI is a superset — built-in providers
 * *and* everything in models.json — needs no session, and returns in well
 * under a second. `fromConfig` remains the fallback for when pi can't be run
 * (missing, too old, or the setup screen is showing), so the picker degrades to
 * the user's declared models rather than going empty.
 *
 * Known limitation: the CLI prints model *ids*, not the display names the RPC
 * catalogue carries, so the home screen shows `us.anthropic.claude-opus-5`
 * where a live session shows "Claude Opus 5 (US)". Deriving pretty names here
 * would mean guessing at pi's naming and drifting from it, so we show what pi
 * shows.
 *
 * `resolveBinary` and `fromConfig` are injected so this composes without
 * requiring a pi binary on PATH under test.
 */
export async function resolveCatalogueModels(
  resolveBinary: () => Promise<string | null>,
  fromConfig: () => Promise<CatalogueModel[]>,
): Promise<CatalogueModel[]> {
  try {
    const binaryPath = await resolveBinary()
    if (binaryPath) {
      const models = await listModelsViaCli(binaryPath)
      if (models.length > 0) return models
    }
  } catch {
    // Fall through to the config-only view.
  }
  return fromConfig()
}

/** Run `pi --list-models` and parse its table. */
export async function listModelsViaCli(binaryPath: string): Promise<CatalogueModel[]> {
  // `--offline` keeps this off the network: the catalogue is already on disk,
  // and a stalled refresh would hang the home screen's picker.
  const { stdout } = await execFileAsync(binaryPath, ['--list-models', '--offline'], {
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
    env: await piProcessEnv(),
  })
  return parseModelTable(stdout)
}

/**
 * Parse the whitespace-aligned table `pi --list-models` prints:
 *
 * ```
 * provider        model                       context  max-out  thinking  images
 * amazon-bedrock  anthropic.claude-opus-4-8   1M       128K     yes       yes
 * local-stark     Qwen 3.5 122b               128K     16.4K    no        no
 * ```
 *
 * Columns are separated by runs of two-or-more spaces, never a single one:
 * model ids may legally contain single spaces ("Qwen 3.5 122b"), so splitting
 * on generic whitespace would shear that id into three columns and drop it.
 */
export function parseModelTable(stdout: string): CatalogueModel[] {
  const models: CatalogueModel[] = []
  const seen = new Set<string>()

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine.trim()) continue

    const fields = rawLine.trim().split(/\s{2,}/)
    // provider, model, context, max-out, thinking[, images]
    if (fields.length < 5) continue

    const [provider, id, , , thinking] = fields as [string, string, string, string, string]
    // The header row, and any banner pi prints above it.
    if (provider === 'provider' || id === 'model') continue
    if (!provider || !id) continue

    const key = `${provider}\u0000${id}`
    if (seen.has(key)) continue
    seen.add(key)

    models.push({
      id,
      name: id,
      provider,
      // Per-model truth from pi, rather than the provider-wide
      // `compat.supportsReasoningEffort` guess models.json could offer.
      reasoning: thinking.toLowerCase() === 'yes',
    })
  }
  return models
}
