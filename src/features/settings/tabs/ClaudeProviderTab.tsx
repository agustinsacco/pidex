import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ClaudeStatus, PiPackageEntry } from '@shared/models'
import { usePackageJob } from '../usePackageJob'
import { isNewerVersion } from '../versions'
import { JobOutput } from './ExtensionsTab'

/** Claude Code line the extension is tested against (see the fork's CI). */
const TESTED_CLI_LINE = '2.1'

/**
 * Settings → Claude Code: health and proof for the pi-claude-cli provider.
 * Shown only while the package is in pi's packages (see SettingsModal).
 */
export function ClaudeProviderTab(): React.JSX.Element {
  const [pkg, setPkg] = useState<PiPackageEntry | null | undefined>(undefined)
  const [latest, setLatest] = useState<string | null>(null)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [entries, claudeState] = await Promise.all([
      window.pidex.invoke('packages:list'),
      window.pidex.invoke('packages:claudeStatus'),
    ])
    const entry = entries.find((e) => e.spec.includes('pi-claude-cli')) ?? null
    setPkg(entry)
    setStatus(claudeState)
    if (entry) {
      void window.pidex
        .invoke('packages:checkUpdates')
        .then((map) => setLatest(map[entry.spec] ?? null))
        .catch(() => setLatest(null))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const updateJob = usePackageJob(() => void refresh())
  const testJob = usePackageJob()
  const updatable =
    latest !== null && pkg?.version !== undefined && isNewerVersion(latest, pkg.version)
  const binaryOk = status?.binary.found === true
  const authOk = status?.auth.loggedIn === true

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold">Claude Code provider</h2>
      <p className="text-text-secondary mt-1 text-base">
        Routes model calls through the Claude Code CLI, billing your Claude Pro/Max plan. Claude
        models appear in the model picker under the <span className="font-mono">pi-claude-cli</span>{' '}
        provider.
      </p>

      <h3 className="mt-5 text-lg font-semibold">Health</h3>
      <div className="border-border mt-2 divide-y rounded-lg border">
        <StatusRow
          label="Extension package"
          ok={pkg != null && pkg.installed}
          detail={
            pkg === undefined
              ? 'checking…'
              : pkg === null
                ? 'not in pi packages — add it from the Extensions tab'
                : pkg.installed
                  ? `${pkg.name} v${pkg.version ?? '?'} (${pkg.scope})`
                  : 'declared — installs on next session start'
          }
        />
        {updatable && (
          <div className="border-border flex items-center justify-between gap-3 border-t px-3.5 py-2.5">
            <div className="text-base">
              <span className="text-accent font-medium">v{latest} is available.</span>{' '}
              <span className="text-text-secondary">
                pi never moves an installed package on its own — update, then restart sessions.
              </span>
            </div>
            <button
              onClick={() =>
                void updateJob.start(() =>
                  window.pidex.invoke('packages:run', 'update', pkg!.spec, 'global', undefined),
                )
              }
              disabled={updateJob.running}
              className="bg-accent hover:bg-accent-hover text-accent-text shrink-0 rounded-md px-2.5 py-1 text-base font-medium transition-colors disabled:opacity-50"
            >
              {updateJob.running ? 'Updating…' : 'Update'}
            </button>
          </div>
        )}
        <StatusRow
          label="claude CLI"
          ok={binaryOk}
          detail={
            status === null
              ? 'checking…'
              : binaryOk
                ? `${status.binary.version ? `v${status.binary.version}` : 'version unknown'} at ${status.binary.path}`
                : 'not found on your login-shell PATH — npm install -g @anthropic-ai/claude-code'
          }
        />
        <StatusRow
          label="Claude account"
          ok={authOk}
          detail={
            status === null
              ? 'checking…'
              : authOk
                ? `${status.auth.email ?? 'logged in'} (${status.auth.method ?? 'unknown method'})`
                : status.auth.ok
                  ? 'not logged in — run `claude` in a terminal and use /login'
                  : (status.auth.error ?? 'auth state unknown')
          }
        />
      </div>
      {status?.binary.version && !status.binary.version.startsWith(`${TESTED_CLI_LINE}.`) && (
        <p className="text-warning mt-2 text-sm">
          This extension is tested against Claude Code {TESTED_CLI_LINE}.x; you have{' '}
          {status.binary.version}. It may still work — run the test below.
        </p>
      )}

      <h3 className="mt-6 text-lg font-semibold">Prove it end to end</h3>
      <p className="text-text-secondary mt-1 text-base">
        Runs one tiny print-mode prompt through pi with the{' '}
        <span className="font-mono">pi-claude-cli/claude-haiku-4-5</span> model — exercising the
        CLI, your login, and the extension. Uses a negligible amount of plan quota.
      </p>
      <button
        onClick={() => void testJob.start(() => window.pidex.invoke('packages:testClaudeProvider'))}
        disabled={testJob.running || !binaryOk}
        className="bg-accent hover:bg-accent-hover text-accent-text mt-2.5 rounded-md px-3 py-1.5 text-base font-medium transition-colors disabled:opacity-50"
      >
        {testJob.running ? 'Testing…' : 'Test provider'}
      </button>
      <JobOutput
        running={updateJob.running}
        output={updateJob.output}
        exitCode={updateJob.exitCode}
      />
      <JobOutput running={testJob.running} output={testJob.output} exitCode={testJob.exitCode} />
      {testJob.exitCode === 0 && testJob.output.includes('pidex-provider-ok') && (
        <p className="text-success mt-2 text-base">
          Round-trip confirmed — the provider is fully working.
        </p>
      )}

      <h3 className="mt-6 text-lg font-semibold">When it fails</h3>
      <ul className="text-text-secondary mt-1 list-disc space-y-1 pl-5 text-base">
        <li>
          <span className="font-mono">claude</span> missing: GUI launches only see your login-shell
          PATH — install with{' '}
          <span className="font-mono">npm install -g @anthropic-ai/claude-code</span>.
        </li>
        <li>
          Logged out or expired: run <span className="font-mono">claude</span> in a terminal and{' '}
          <span className="font-mono">/login</span>; pidex picks it up on the next test.
        </li>
        <li>
          Empty replies after a Claude Code update: the CLI&apos;s stream format may have moved —
          check the extension repo for a newer release.
        </li>
      </ul>
    </div>
  )
}

function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string
  ok: boolean
  detail: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span
        className={clsx('h-2 w-2 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-warning')}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        <div className="text-text-tertiary truncate font-mono text-sm">{detail}</div>
      </div>
    </div>
  )
}
