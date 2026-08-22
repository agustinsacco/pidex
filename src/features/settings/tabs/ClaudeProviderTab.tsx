import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { ClaudeStatus, ClaudeSystemPromptMode, PiPackageEntry } from '@shared/models'
import { Button } from '@/components/form'
import { usePackageJob } from '../usePackageJob'
import { isNewerVersion } from '../versions'
import { JobOutput } from '../JobOutput'

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
  const [promptMode, setPromptMode] = useState<ClaudeSystemPromptMode>('claude')

  const setPromptModePref = useCallback((mode: ClaudeSystemPromptMode): void => {
    setPromptMode(mode)
    void window.pidex.invoke('app:setClaudeSystemPrompt', mode)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const [entries, claudeState, prefs] = await Promise.all([
      window.pidex.invoke('packages:list'),
      window.pidex.invoke('packages:claudeStatus'),
      window.pidex.invoke('app:getPrefs'),
    ])
    const entry = entries.find((e) => e.spec.includes('pi-claude-cli')) ?? null
    setPkg(entry)
    setStatus(claudeState)
    setPromptMode(prefs.claudeSystemPrompt)
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

      <h3 className="mt-6 text-lg font-semibold">System prompt</h3>
      <p className="text-text-secondary mt-1 text-base">
        Whose instructions the <span className="font-mono">claude</span> subprocess runs under.
        Applies to sessions you start from now on — the CLI keeps its system prompt for the life of
        a session.
      </p>
      <div className="mt-2.5 space-y-2">
        <PromptModeOption
          value="claude"
          current={promptMode}
          onSelect={setPromptModePref}
          title="Claude Code's, plus pi's"
          detail="Layers pi's prompt on top of Claude Code's own. Everything the CLI normally knows about its tools stays in place."
        />
        <PromptModeOption
          value="pi"
          current={promptMode}
          onSelect={setPromptModePref}
          title="pi's only"
          detail="Replaces Claude Code's prompt entirely, freeing roughly 12k tokens of context per call. The model works from pi's instructions plus the raw tool schemas, so behaviour can differ."
        />
      </div>
      <p className="text-text-tertiary mt-2 text-sm">
        Needs the extension at v0.4.7 or newer; older versions ignore the setting and always append.
      </p>

      <h3 className="mt-6 text-lg font-semibold">Prove it end to end</h3>
      <p className="text-text-secondary mt-1 text-base">
        Runs one tiny print-mode prompt through pi with the{' '}
        <span className="font-mono">pi-claude-cli/claude-haiku-4-5</span> model — exercising the
        CLI, your login, and the extension. Uses a negligible amount of plan quota.
      </p>
      <Button
        variant="primary"
        onClick={() => void testJob.start(() => window.pidex.invoke('packages:testClaudeProvider'))}
        disabled={testJob.running || !binaryOk}
        className="mt-2.5"
      >
        {testJob.running ? 'Testing…' : 'Test provider'}
      </Button>
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

/** One radio-style choice of system prompt. */
function PromptModeOption({
  value,
  current,
  onSelect,
  title,
  detail,
}: {
  value: ClaudeSystemPromptMode
  current: ClaudeSystemPromptMode
  onSelect: (mode: ClaudeSystemPromptMode) => void
  title: string
  detail: string
}): React.JSX.Element {
  const selected = current === value
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={clsx(
        'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-accent bg-accent/5' : 'border-border hover:bg-bg-secondary',
      )}
    >
      <span
        className={clsx(
          'mt-1 h-3 w-3 shrink-0 rounded-full border-2',
          selected ? 'border-accent bg-accent' : 'border-border-strong',
        )}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="text-text block text-base font-medium">{title}</span>
        <span className="text-text-secondary block text-sm leading-snug">{detail}</span>
      </span>
    </button>
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
