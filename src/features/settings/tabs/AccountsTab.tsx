import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SubscriptionProviderStatus } from '@shared/models'
import { Button } from '@/components/form'
import { TerminalView } from '@/features/terminal/TerminalView'

/**
 * How often to re-check auth while the login terminal is open.
 *
 * pi writes `auth.json` when the OAuth callback lands, and tells us nothing —
 * there is no event to subscribe to, so polling is the only way to notice.
 * Three seconds is slow enough to be free and fast enough that the card flips
 * while the user is still looking at the terminal.
 */
const POLL_MS = 3_000

export function AccountsTab(): React.JSX.Element {
  const [providers, setProviders] = useState<SubscriptionProviderStatus[] | null>(null)
  const [ptyId, setPtyId] = useState<string | null>(null)
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const sentLogin = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.pidex.invoke('pi:subscriptionAuth')
    setProviders(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll only while the terminal is open — this shells out to pi once per
  // provider, so it has no business running when nothing can change.
  useEffect(() => {
    if (!ptyId) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [ptyId, refresh])

  const openLogin = async (): Promise<void> => {
    setSpawnError(null)
    try {
      const { ptyId: id } = await window.pidex.invoke('pi:loginTerminal', 80, 20)
      sentLogin.current = false
      setPtyId(id)
      /*
       * pi's TUI needs a moment before it will accept input; typing into a
       * half-started process drops the keystrokes. There is no ready signal on
       * the PTY, so this is a delay — and it is why the command is still
       * visible and re-typeable if it misses.
       */
      setTimeout(() => {
        if (sentLogin.current) return
        sentLogin.current = true
        void window.pidex.invoke('pty:write', id, '/login\r')
      }, 1_200)
    } catch (error) {
      setSpawnError(error instanceof Error ? error.message : String(error))
    }
  }

  const closeLogin = (): void => {
    if (ptyId) void window.pidex.invoke('pty:kill', ptyId)
    setPtyId(null)
    void refresh()
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold">Accounts</h2>
      <p className="text-text-secondary mt-1 text-base">
        Sign pi into a provider with a subscription instead of an API key. Signed-in providers put
        their models in the picker for every session.
      </p>

      <div className="border-border mt-4 divide-y rounded-lg border">
        {providers === null && (
          <div className="text-text-secondary px-3.5 py-3 text-base">Checking…</div>
        )}
        {providers?.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </div>

      {spawnError && <p className="text-danger mt-3 text-base">Could not start pi: {spawnError}</p>}

      {ptyId === null ? (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void openLogin()}>Sign in…</Button>
          <button
            onClick={() => void refresh()}
            className="text-text-secondary hover:text-text text-base"
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-text-secondary text-base">
              Pick a provider in pi’s menu, then finish in your browser.
            </p>
            <button onClick={closeLogin} className="text-text-secondary hover:text-text text-base">
              Done
            </button>
          </div>
          <div className="border-border h-64 overflow-hidden rounded-lg border p-2">
            <TerminalView ptyId={ptyId} visible />
          </div>
          <p className="text-text-tertiary mt-2 text-sm">
            This is pi’s own <span className="font-mono">/login</span>. If the menu didn’t open,
            type <span className="font-mono">/login</span> and press Enter.
          </p>
        </div>
      )}
    </div>
  )
}

function ProviderRow({ provider }: { provider: SubscriptionProviderStatus }): React.JSX.Element {
  const ready = provider.status === 'ready'
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium">{provider.name}</span>
          <span className="text-text-tertiary font-mono text-sm">{provider.id}</span>
        </div>
        <p className="text-text-secondary mt-0.5 text-sm">Requires {provider.requires}.</p>
        {provider.caveat && <p className="text-text-tertiary mt-1 text-sm">{provider.caveat}</p>}
        {provider.error && <p className="text-danger mt-1 text-sm">{provider.error}</p>}
      </div>
      <span
        className={clsx(
          'shrink-0 rounded-full px-2 py-0.5 text-sm',
          ready
            ? 'bg-success/15 text-success'
            : provider.status === 'unknown'
              ? 'bg-warning/15 text-warning'
              : 'bg-surface-raised text-text-tertiary',
        )}
        title={provider.reason}
      >
        {ready ? 'Signed in' : provider.status === 'unknown' ? 'Unknown' : 'Not signed in'}
      </span>
    </div>
  )
}
