import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SubscriptionProvider, SubscriptionProviderStatus } from '@shared/models'
import { checkPiHealth } from './health'
import { piProcessEnv } from './shell-env'

const execFileAsync = promisify(execFile)

/**
 * Providers pi can sign into with a subscription instead of an API key.
 *
 * Hand-curated, because pi offers no way to enumerate them: `/login` is
 * TUI-only, the RPC protocol has no auth command, and `@earendil-works/pi-ai`
 * stopped exporting its OAuth registry publicly — in 0.84 the `./oauth`
 * subpath is types-only, and the runtime moved from where 0.79 kept it.
 * Deep-importing that private path would break on a pi upgrade, so this list
 * is maintained by hand against pi's providers doc instead. Every id here is
 * verified to be accepted by `pi auth check --provider`; an id pi does not
 * know answers `provider_not_found`, which surfaces as "unknown".
 */
export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = [
  {
    id: 'openai-codex',
    name: 'ChatGPT (Codex)',
    requires: 'ChatGPT Plus or Pro',
    caveat:
      'Signing in through an OSS client is a supported path — OpenAI names pi specifically. Usage counts against your included ChatGPT usage.',
  },
  {
    id: 'anthropic',
    name: 'Claude Pro/Max',
    requires: 'Claude Pro or Max',
    caveat:
      'Per pi’s own docs, third-party harness usage bills per token from extra usage — not against your Claude plan limits. For plan-limit usage, use the Claude Code provider extension instead.',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    requires: 'a Copilot subscription',
    caveat:
      'Sign-in asks for a domain: press Enter for github.com, or type a GitHub Enterprise Server host.',
  },
]

/**
 * Parse one `pi auth check --json` line.
 *
 * Pure and total: any shape we do not recognise becomes `unknown` rather than
 * throwing, because this runs for every provider on every settings open and a
 * malformed line must not take the tab down with it.
 */
export function parseAuthCheck(stdout: string): {
  status: 'ready' | 'not_ready' | 'unknown'
  reason?: string
} {
  const line = stdout.trim().split('\n').at(-1)?.trim()
  if (!line || !line.startsWith('{')) return { status: 'unknown' }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { status: 'unknown' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'unknown' }
  const record = parsed as Record<string, unknown>
  const status = record.status
  const reason = typeof record.reason === 'string' ? record.reason : undefined
  if (status === 'ready') return { status: 'ready' }
  if (status === 'not_ready') return { status: 'not_ready', reason }
  return { status: 'unknown', reason }
}

/**
 * Ask pi whether each subscription provider is signed in.
 *
 * `--no-refresh` on purpose: refreshing an expired OAuth token is a network
 * round trip per provider, and this runs on every settings open. A token that
 * needs refreshing still reports `ready` — pi refreshes it when a session
 * actually uses it.
 */
export async function checkSubscriptionAuth(): Promise<SubscriptionProviderStatus[]> {
  const health = await checkPiHealth()
  if (!health.ok || !health.binaryPath) {
    const error = health.message ?? 'pi is not available'
    return SUBSCRIPTION_PROVIDERS.map((p) => ({ ...p, status: 'unknown' as const, error }))
  }

  // pi is a `#!/usr/bin/env node` script — it needs the login shell's PATH to
  // find node under a version manager (see shell-env.ts).
  const env = await piProcessEnv()
  const binaryPath = health.binaryPath

  return Promise.all(
    SUBSCRIPTION_PROVIDERS.map(async (provider) => {
      try {
        const { stdout } = await execFileAsync(
          binaryPath,
          ['auth', 'check', '--provider', provider.id, '--json', '--no-refresh'],
          { env, timeout: 10_000, encoding: 'utf8' },
        )
        return { ...provider, ...parseAuthCheck(stdout) }
      } catch (error) {
        // `pi auth check` exits 0 even for not_ready, so a throw here means the
        // spawn or the timeout failed — never "the user is signed out".
        const stdout = (error as { stdout?: string }).stdout
        if (typeof stdout === 'string' && stdout.includes('{')) {
          return { ...provider, ...parseAuthCheck(stdout) }
        }
        return {
          ...provider,
          status: 'unknown' as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
}
