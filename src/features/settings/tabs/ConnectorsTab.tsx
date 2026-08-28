import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { McpConfigsResult, McpResolvedServer } from '@shared/mcp'
import { errorText } from '@shared/errors'
import { useActiveWorkspace } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { useConnectorsStore, type ConnectFlow } from '@/stores/connectors'
import { Button, TextInput } from '@/components/form'
import {
  CONNECTORS,
  buildConnectorConfig,
  connectorForUrl,
  connectorUrl,
  type ConnectorChoice,
  type ConnectorEntry,
} from '@/features/connectors/catalog'
import {
  MCP_STATUS_STATUS_KEY,
  parseMcpStatus,
  stateLabel,
  type McpServerState,
} from '@/features/connectors/mcpStatus'
import { useSettingsUiStore } from '../settingsUiStore'

/**
 * Settings → Connectors: connect real services over OAuth.
 *
 * pidex writes the mcp.json entry and drives the adapter's own `/mcp-auth`
 * command; the adapter owns the protocol and the tokens. Nothing here ever
 * sees a credential. The MCP tab remains the place for the resolution chain,
 * raw JSON repair and non-catalog servers.
 */
export function ConnectorsTab(): React.JSX.Element {
  const workspacePath = useActiveWorkspace()
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const [configs, setConfigs] = useState<McpConfigsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const flows = useConnectorsStore((s) => s.flows)
  const statusText = useExtensionUiStore((s) =>
    activeSessionId ? s.statuses[activeSessionId]?.[MCP_STATUS_STATUS_KEY] : undefined,
  )
  const status = useMemo(() => parseMcpStatus(statusText), [statusText])

  const reload = useCallback(async () => {
    try {
      setConfigs(await window.pidex.invoke('mcp:readConfigs', workspacePath ?? undefined))
    } catch (err) {
      setError(errorText(err))
    }
  }, [workspacePath])

  useEffect(() => {
    void reload()
  }, [reload])

  const configured = useMemo(() => {
    const byConnector = new Map<string, McpResolvedServer>()
    for (const server of configs?.servers ?? []) {
      const entry = connectorForUrl(server.config.url)
      if (entry && !byConnector.has(entry.id)) byConnector.set(entry.id, server)
    }
    return byConnector
  }, [configs])

  const add = async (entry: ConnectorEntry, choice: ConnectorChoice): Promise<void> => {
    setError(null)
    try {
      const config = buildConnectorConfig(entry, choice)
      await window.pidex.invoke(
        'mcp:upsertServer',
        'pi-global',
        undefined,
        entry.serverName,
        config,
      )
      await reload()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const remove = async (server: McpResolvedServer): Promise<void> => {
    setError(null)
    try {
      await window.pidex.invoke(
        'mcp:removeServer',
        server.scope,
        workspacePath ?? undefined,
        server.name,
      )
      await reload()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold">Connectors</h2>
      <p className="text-text-secondary mt-1 text-base">
        Services reachable over the Model Context Protocol. Signing in runs the MCP adapter&apos;s
        own OAuth flow — it stores the tokens in your operating system&apos;s credential store, and
        pidex never holds a copy.
      </p>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger mt-3 rounded-lg border px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {CONNECTORS.map((entry) => (
          <ConnectorRow
            key={entry.id}
            entry={entry}
            server={configured.get(entry.id)}
            state={
              status?.servers.find((s) => s.name === configured.get(entry.id)?.name)?.state ?? null
            }
            toolCount={
              status?.servers.find((s) => s.name === configured.get(entry.id)?.name)?.toolCount ?? 0
            }
            flow={flows[configured.get(entry.id)?.name ?? entry.serverName]}
            sessionId={activeSessionId}
            onAdd={(choice) => void add(entry, choice)}
            onRemove={(server) => void remove(server)}
          />
        ))}
      </div>

      <div className="text-text-tertiary mt-5 text-sm">
        Custom servers, the mcp.json resolution chain and raw JSON repair live in{' '}
        <button
          onClick={() => useSettingsUiStore.getState().setTab('mcp')}
          className="underline underline-offset-2"
        >
          Settings → MCP
        </button>
        .
      </div>
    </div>
  )
}

const STATE_DOT: Record<McpServerState, string> = {
  connected: 'bg-success',
  'needs-auth': 'bg-warning',
  failed: 'bg-danger',
  cached: 'bg-info',
  disabled: 'bg-border-strong',
  'not-connected': 'bg-border-strong',
}

function ConnectorRow({
  entry,
  server,
  state,
  toolCount,
  flow,
  sessionId,
  onAdd,
  onRemove,
}: {
  entry: ConnectorEntry
  server?: McpResolvedServer
  state: McpServerState | null
  toolCount: number
  flow?: ConnectFlow
  sessionId: string | null
  onAdd: (choice: ConnectorChoice) => void
  onRemove: (server: McpResolvedServer) => void
}): React.JSX.Element {
  const [variant, setVariant] = useState(entry.variants?.options[0]?.id ?? '')
  const [readOnly, setReadOnly] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const choice: ConnectorChoice = { variant, readOnly, clientId, clientSecret }
  const serverName = server?.name ?? entry.serverName
  const url = server?.config.url ?? connectorUrl(entry, { variant, readOnly })

  return (
    <div
      className="border-border rounded-lg border px-3 py-2"
      data-testid={`connector-${entry.id}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg font-medium">{entry.name}</span>
        {server && !state && !sessionId && (
          <span
            className="text-text-tertiary shrink-0 text-sm"
            title="Per-server state comes from the MCP adapter, which runs inside a session"
          >
            state unknown
          </span>
        )}
        {server && state && (
          <span
            className="text-text-tertiary flex shrink-0 items-center gap-1.5 text-sm"
            title={`${serverName}: ${stateLabel(state)}`}
          >
            <span className={clsx('h-1.5 w-1.5 rounded-full', STATE_DOT[state])} />
            {stateLabel(state)}
            {state === 'connected' && toolCount > 0 && ` · ${toolCount} tools`}
          </span>
        )}
        <span className="text-text-tertiary min-w-0 flex-1 truncate font-mono text-sm" title={url}>
          {url}
        </span>
        {server ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                const store = useConnectorsStore.getState()
                // Reconnect needs the process that holds the connection;
                // signing in does not, and runs headless when nothing is live.
                if (state === 'connected' && sessionId) {
                  void store.reconnect(sessionId, serverName)
                } else {
                  void store.connect(serverName, sessionId ?? undefined)
                }
              }}
            >
              {state === 'connected' ? 'Reconnect' : 'Sign in'}
            </Button>
            <button
              onClick={() => {
                void useConnectorsStore.getState().disconnect(serverName, sessionId ?? undefined)
                onRemove(server)
              }}
              className="text-text-tertiary hover:text-danger shrink-0 text-sm underline-offset-2 hover:underline"
            >
              Remove
            </button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => onAdd(choice)}>
            Add
          </Button>
        )}
      </div>

      <div className="text-text-tertiary mt-0.5 text-sm">{entry.summary}</div>
      {entry.caveat && <div className="text-text-tertiary mt-1 text-sm">{entry.caveat}</div>}

      {!server && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm">
          {entry.variants && (
            <label className="flex items-center gap-1.5">
              {entry.variants.label}
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="border-border bg-bg-secondary rounded px-1.5 py-0.5"
              >
                {entry.variants.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {entry.readOnlyUrl && (
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              read-only
            </label>
          )}
          {entry.authKind === 'confidential' && (
            <>
              <TextInput
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="client ID"
                className="w-40 font-mono"
              />
              <TextInput
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="client secret"
                className="w-40 font-mono"
              />
            </>
          )}
        </div>
      )}

      {flow && <FlowCard serverName={serverName} flow={flow} />}
    </div>
  )
}

/** What the authorization round-trip looks like while it is happening. */
function FlowCard({
  serverName,
  flow,
}: {
  serverName: string
  flow: ConnectFlow
}): React.JSX.Element {
  const [pasted, setPasted] = useState('')
  const store = useConnectorsStore.getState()

  if (flow.phase === 'starting') {
    return <Note>Starting authorization…</Note>
  }
  if (flow.phase === 'connected') {
    return (
      <Note tone="success">
        Authorized. <Dismiss onClick={() => store.dismiss(serverName)} />
      </Note>
    )
  }
  if (flow.phase === 'failed') {
    return (
      <Note tone="danger">
        {flow.message} <Dismiss onClick={() => store.dismiss(serverName)} />
      </Note>
    )
  }

  return (
    <div className="border-border bg-bg-secondary/40 mt-2 rounded-lg border px-3 py-2 text-sm">
      <div className="text-text">Approve access in your browser to finish signing in.</div>
      <div className="text-text-tertiary mt-1 break-all font-mono text-xs">
        {flow.authorizationUrl}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <TextInput
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="…or paste the localhost callback URL"
          className="min-w-0 flex-1 font-mono"
        />
        <Button
          size="sm"
          disabled={!pasted.trim()}
          onClick={() => store.submitCallbackUrl(serverName, pasted)}
        >
          Finish
        </Button>
        <Button size="sm" onClick={() => store.cancel(serverName)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Note({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'danger'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={clsx(
        'mt-2 rounded-lg border px-3 py-1.5 text-sm',
        tone === 'success' && 'border-success/30 bg-success/10 text-success',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        tone === 'neutral' && 'border-border bg-bg-secondary/40 text-text-secondary',
      )}
    >
      {children}
    </div>
  )
}

function Dismiss({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button onClick={onClick} className="underline underline-offset-2">
      dismiss
    </button>
  )
}
