import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type {
  ClaudeLoginState,
  ClaudeStatus,
  ClaudeUsageSnapshotResult,
  PiPackageEntry,
} from '@shared/models'
import { Button, TextInput } from '@/components/form'
import { Spinner } from '@/components/icons'
import { usePackageJob } from '../usePackageJob'
import { isNewerVersion } from '@shared/version'
import { JobOutput } from '../JobOutput'
import { usageBarClass, usageTextClass, windowResetLabel, windowTitle } from '@/lib/claudeUsage'

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
  const [login, setLogin] = useState<ClaudeLoginState | null>(null)

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

  // Sign-in progress is an event, not a return value: the middle of it is a
  // human in a browser. Terminal phases re-read status so the row shows the
  // account that is actually live, not the one we hoped for.
  useEffect(
    () =>
      window.pidex.onClaudeLoginState((state) => {
        setLogin(state.phase === 'signed-in' || state.phase === 'cancelled' ? null : state)
        if (state.phase === 'signed-in' || state.phase === 'cancelled') void refresh()
      }),
    [refresh],
  )

  const updateJob = usePackageJob(() => void refresh())
  const testJob = usePackageJob()
  const updatable =
    latest !== null && pkg?.version !== undefined && isNewerVersion(latest, pkg.version)
  const binaryOk = status?.binary.found === true

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
        <ClaudeAccountRow
          status={status}
          login={login}
          disabled={!binaryOk}
          onChanged={() => void refresh()}
          onLoginState={setLogin}
        />
      </div>
      {status?.binary.version && !status.binary.version.startsWith(`${TESTED_CLI_LINE}.`) && (
        <p className="text-warning mt-2 text-sm">
          This extension is tested against Claude Code {TESTED_CLI_LINE}.x; you have{' '}
          {status.binary.version}. It may still work — run the test below.
        </p>
      )}

      <UsageSection binaryOk={binaryOk} />

      <ContextWindowSection />

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
          Logged out or expired: use <strong>Sign in</strong> above. It drives{' '}
          <span className="font-mono">claude auth login</span> for you — no terminal needed.
        </li>
        <li>
          Empty replies after a Claude Code update: the CLI&apos;s stream format may have moved —
          check the extension repo for a newer release.
        </li>
      </ul>
    </div>
  )
}

/**
 * The Claude account: who is signed in, and the whole sign-in/out flow.
 *
 * This is the row that used to say “run `claude` in a terminal”. The credential
 * belongs to the `claude` binary, not to pidex or to pi, so switching accounts
 * is sign-out-then-sign-in — the CLI keeps exactly one, in the OS keychain, and
 * there is no way to hold two side by side. Saying so beats a user hunting for
 * an “Add account” button that cannot exist.
 */
function ClaudeAccountRow({
  status,
  login,
  disabled,
  onChanged,
  onLoginState,
}: {
  status: ClaudeStatus | null
  login: ClaudeLoginState | null
  disabled: boolean
  onChanged: () => void
  onLoginState: (state: ClaudeLoginState | null) => void
}): React.JSX.Element {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const auth = status?.auth
  const signedIn = auth?.loggedIn === true
  const inFlight = login !== null

  const start = async (): Promise<void> => {
    setCode('')
    onLoginState({ phase: 'starting' })
    try {
      await window.pidex.invoke('claude:startLogin')
    } catch (caught) {
      onLoginState({
        phase: 'error',
        message: caught instanceof Error ? caught.message : String(caught),
      })
    }
  }

  const submit = async (): Promise<void> => {
    if (!code.trim()) return
    try {
      await window.pidex.invoke('claude:submitCode', code.trim())
      setCode('')
    } catch (caught) {
      onLoginState({
        phase: 'error',
        message: caught instanceof Error ? caught.message : String(caught),
      })
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.pidex.invoke('claude:logout')
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const detail =
    status === null
      ? 'checking…'
      : signedIn
        ? [
            auth?.email ?? 'logged in',
            auth?.plan,
            auth?.organization,
            auth?.method !== 'claude.ai' ? auth?.method : undefined,
          ]
            .filter(Boolean)
            .join(' · ')
        : auth?.ok
          ? 'not signed in'
          : (auth?.error ?? 'auth state unknown')

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={clsx(
              'h-2 w-2 shrink-0 rounded-full',
              signedIn ? 'bg-success' : 'bg-warning',
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="text-base font-medium">Claude account</div>
            <div className="text-text-tertiary truncate font-mono text-sm">{detail}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {inFlight ? (
            <button
              onClick={() => {
                void window.pidex.invoke('claude:cancelLogin')
                onLoginState(null)
              }}
              className="text-text-secondary hover:text-text text-base"
            >
              Cancel
            </button>
          ) : (
            <>
              {signedIn && (
                <button
                  onClick={() => void signOut()}
                  disabled={busy}
                  className="text-text-secondary hover:text-text text-base disabled:opacity-50"
                >
                  {busy ? 'Signing out…' : 'Sign out'}
                </button>
              )}
              <Button variant="secondary" disabled={disabled || busy} onClick={() => void start()}>
                {signedIn ? 'Switch account' : 'Sign in'}
              </Button>
            </>
          )}
        </div>
      </div>

      {login?.phase === 'starting' && (
        <div className="text-text-secondary mt-3 flex items-center gap-2 text-sm">
          <Spinner />
          Starting the Claude CLI’s sign-in…
        </div>
      )}

      {login?.phase === 'finishing' && (
        <div className="text-text-secondary mt-3 flex items-center gap-2 text-sm">
          <Spinner />
          Finishing sign-in…
        </div>
      )}

      {login?.phase === 'error' && <p className="text-danger mt-3 text-sm">{login.message}</p>}

      {login?.phase === 'awaiting-code' && (
        <div className="border-border bg-surface-raised mt-3 rounded-md border p-3">
          {login.invalidCode && (
            <p className="text-danger text-sm">
              That code wasn’t accepted. Use the fresh link below — the earlier one has expired.
            </p>
          )}
          {/* The paste-back step is the one people miss: the CLI's OAuth
              redirect lands on a page showing a code, and nothing on screen
              says it has to come back here. */}
          <p className="text-text-secondary text-sm">
            Finish in the browser, then paste the code Claude shows you:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <TextInput
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              placeholder="Paste code"
              className="min-w-0 flex-1 rounded-md font-mono"
            />
            <Button variant="primary" disabled={!code.trim()} onClick={() => void submit()}>
              Continue
            </Button>
          </div>
          <button
            onClick={() => void window.pidex.invoke('app:openExternal', login.url)}
            className="text-accent mt-2.5 block text-sm hover:underline"
          >
            Browser didn’t open? Open the sign-in page
          </button>
        </div>
      )}
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

/**
 * Live subscription usage — the same windows Claude Desktop shows (5-hour,
 * weekly, per-model weekly), plus the "what's contributing" context the CLI
 * renders from the same data. This is the diagnostics surface: the popover
 * hides failures, this tab says what they were.
 *
 * The fetch spawns `claude -p /usage`: zero quota, no API key, no credential
 * pidex touches — the CLI reads its own keychain login, so it needs nothing
 * from the user beyond being signed in to a subscription.
 */
function UsageSection({ binaryOk }: { binaryOk: boolean | undefined }): React.JSX.Element {
  const [state, setState] = useState<ClaudeUsageSnapshotResult | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setState(await window.pidex.invoke('claude:usageSnapshot'))
  }, [])

  useEffect(() => {
    if (binaryOk) void refresh()
  }, [binaryOk, refresh])

  return (
    <>
      <h3 className="mt-6 text-lg font-semibold">Usage</h3>
      <div className="border-border mt-2 rounded-lg border px-3.5 py-3">
        {!binaryOk ? (
          <p className="text-text-secondary text-base">claude CLI not found — see Health above.</p>
        ) : state === null ? (
          <div className="text-text-secondary flex items-center gap-2 text-base">
            <Spinner /> Checking your plan usage…
          </div>
        ) : !state.ok ? (
          <p className="text-text-secondary text-base">
            {state.error === 'claude-not-found'
              ? 'claude CLI not found on your login-shell PATH.'
              : state.error === 'run-failed'
                ? 'The usage check ran but did not complete — try again in a moment.'
                : 'No subscription usage to show — sign in to a Claude Pro/Max account above.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {state.snapshot.stale && (
              <p className="text-warning text-sm">
                Last-known usage — the CLI could not refresh it just now.
              </p>
            )}
            {state.snapshot.windows.map((window) => {
              const percent = Math.round(window.percentUsed)
              const reset = windowResetLabel(window.resetsAt)
              return (
                <div key={window.label}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-base">{windowTitle(window)}</span>
                    <span
                      className={clsx('font-mono text-sm tabular-nums', usageTextClass(percent))}
                    >
                      {percent}% used{reset ? ` · ${reset}` : ''}
                    </span>
                  </div>
                  <div className="bg-bg-secondary mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className={clsx('h-full rounded-full', usageBarClass(percent))}
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {state.snapshot.contributing && (
              <div className="border-border/60 border-t pt-2">
                <div className="text-text-tertiary pb-1 font-mono text-2xs uppercase tracking-wider">
                  What&apos;s contributing
                </div>
                <pre className="text-text-tertiary max-h-52 overflow-auto whitespace-pre-wrap font-sans text-sm leading-snug">
                  {state.snapshot.contributing}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Presets for the auto-compact window. `''` is "provider default": the env
 * var is not set at all and pi-claude-cli applies its own 200k cap.
 */
const AUTOCOMPACT_PRESETS = [
  {
    value: '',
    title: 'Default — 200k tokens',
    detail:
      'The provider caps the Claude Code session at 200k and the CLI compacts it in-session. ' +
      'Matches the budget these models run under everywhere the 1M beta is off.',
  },
  {
    value: '400k',
    title: '400k tokens',
    detail:
      'Roomier before each compaction, at roughly double the per-request cache cost once a ' +
      'session grows past 200k.',
  },
  {
    value: 'auto',
    title: 'Model maximum',
    detail:
      'The CLI decides — on 1M-context models a long-lived session can grow toward a million ' +
      'tokens, and every request re-reads all of it. The pre-0.5.0 behaviour.',
  },
] as const

/** Accepted custom values, mirroring the provider: auto, off, or 100k–1M. */
const AUTOCOMPACT_INPUT = /^(auto|off|\d+(\.\d+)?\s*[km]?)$/i

/**
 * Settings → Claude Code → Context window: the auto-compact window for
 * pi-claude-cli sessions (PI_CLAUDE_CLI_AUTOCOMPACT). Applies to sessions
 * started after the change; running sessions keep their window.
 */
function ContextWindowSection(): React.JSX.Element {
  const [value, setValue] = useState('')
  const [customDraft, setCustomDraft] = useState('')
  const [customError, setCustomError] = useState(false)

  useEffect(() => {
    void window.pidex.invoke('app:getPrefs').then((prefs) => {
      const stored = prefs.claudeAutocompact ?? ''
      setValue(stored)
      if (!AUTOCOMPACT_PRESETS.some((p) => p.value === stored)) setCustomDraft(stored)
    })
  }, [])

  const save = useCallback((next: string): void => {
    setValue(next)
    setCustomError(false)
    void window.pidex.invoke('app:setClaudeAutocompact', next)
  }, [])

  const commitCustom = useCallback((): void => {
    const draft = customDraft.trim()
    if (draft === '') {
      save('')
      return
    }
    if (!AUTOCOMPACT_INPUT.test(draft)) {
      setCustomError(true)
      return
    }
    save(draft)
  }, [customDraft, save])

  const isPreset = AUTOCOMPACT_PRESETS.some((p) => p.value === value)

  return (
    <>
      <h3 className="mt-6 text-lg font-semibold">Context window</h3>
      <p className="text-text-secondary mt-1 text-base">
        How large a Claude Code session may grow before the CLI compacts it. Smaller windows cost
        less (every request re-reads the whole context) and keep the model focused; compaction
        summarizes older turns in place. Applies to sessions you start from now on.
      </p>
      <div className="mt-2.5 space-y-2" role="radiogroup" aria-label="Auto-compact window">
        {AUTOCOMPACT_PRESETS.map((preset) => {
          const selected = value === preset.value
          return (
            <button
              key={preset.value || 'default'}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => save(preset.value)}
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
                <span className="text-text block text-base font-medium">{preset.title}</span>
                <span className="text-text-secondary block text-sm leading-snug">
                  {preset.detail}
                </span>
              </span>
            </button>
          )
        })}
        <div className="flex items-center gap-2.5 px-3 py-1">
          <span
            className={clsx(
              'h-3 w-3 shrink-0 rounded-full border-2',
              !isPreset ? 'border-accent bg-accent' : 'border-border-strong',
            )}
            aria-hidden
          />
          <span className="text-text text-base font-medium">Custom</span>
          <TextInput
            size="sm"
            className="w-32 font-mono"
            placeholder="e.g. 300k"
            aria-label="Custom auto-compact window"
            value={customDraft}
            onChange={(e) => {
              setCustomDraft(e.target.value)
              setCustomError(false)
            }}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustom()
            }}
          />
          {customError && (
            <span className="text-warning text-sm">
              Use a window from 100k to 1M (e.g. 300k), auto, or off.
            </span>
          )}
        </div>
      </div>
      <p className="text-text-tertiary mt-2 text-sm">
        Needs pi-claude-cli 0.5.0 or newer; older versions ignore the setting. pi&apos;s own
        transcript compaction is configured separately in the Agent tab.
      </p>
    </>
  )
}
