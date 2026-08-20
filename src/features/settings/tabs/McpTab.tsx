import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  McpCacheEntry,
  McpConfigsResult,
  McpResolvedServer,
  McpScope,
  McpServerConfig,
  McpWriteScope,
} from '@shared/mcp'
import { useActiveWorkspace } from '@/stores/workspaces'
import { useSessionsStore } from '@/stores/sessions'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { stripAnsi } from '@/lib/ansi'
import { ChevronIcon } from '@/components/icons'

const SCOPE_LABELS: Record<McpScope, string> = {
  xdg: '~/.config/mcp',
  agents: '~/.agents',
  'agents-dir': '~/.agents/mcp',
  'pi-global': 'pi global',
  project: 'project .mcp.json',
  'pi-project': 'project .pi',
}

const ADAPTER_PACKAGE = 'npm:pi-mcp-adapter'

/**
 * Settings → MCP: manage the pi-mcp-adapter's mcp.json chain. pi core has no
 * MCP support — servers configured here are served to sessions by the
 * adapter package, and their tools arrive as ordinary tool calls.
 */
export function McpTab(): React.JSX.Element {
  const workspacePath = useActiveWorkspace()
  const [configs, setConfigs] = useState<McpConfigsResult | null>(null)
  const [cache, setCache] = useState<McpCacheEntry[]>([])
  const [packages, setPackages] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<McpResolvedServer | null>(null)
  const [rawEdit, setRawEdit] = useState<McpScope | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextConfigs, nextCache, settings] = await Promise.all([
        window.pidex.invoke('mcp:readConfigs', workspacePath ?? undefined),
        window.pidex.invoke('mcp:readCache'),
        window.pidex.invoke('pi:agentSettings', workspacePath ?? undefined),
      ])
      setConfigs(nextConfigs)
      setCache(nextCache)
      const pkgs = (settings as { packages?: unknown }).packages
      setPackages(Array.isArray(pkgs) ? (pkgs as string[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const adapterInstalled = packages?.some((p) => p.includes('pi-mcp-adapter')) ?? false

  const installAdapter = async (): Promise<void> => {
    setError(null)
    try {
      // patchAgentSettings merges shallowly — send the FULL appended array.
      await window.pidex.invoke('pi:patchAgentSettings', 'global', undefined, {
        packages: [...(packages ?? []), ADAPTER_PACKAGE],
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold">MCP servers</h2>
      <p className="text-text-secondary mt-1 text-base">
        Model Context Protocol servers, provided to sessions by the{' '}
        <span className="font-mono">pi-mcp-adapter</span> package. Their tools appear in chat as
        ordinary tool calls.
      </p>

      {/* Adapter status */}
      <div className="border-border bg-bg-secondary/50 mt-4 rounded-lg border px-3.5 py-2.5">
        {packages === null ? (
          <div className="text-text-tertiary text-base">Checking pi settings…</div>
        ) : adapterInstalled ? (
          <div className="flex items-center gap-2 text-base">
            <span className="bg-success h-1.5 w-1.5 rounded-full" />
            <span className="text-text">pi-mcp-adapter is in pi&apos;s packages</span>
            <AdapterSessionStatus />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-base">
            <span className="text-text-secondary">
              The adapter package is not installed — servers below will not load.
            </span>
            <button
              onClick={() => void installAdapter()}
              className="bg-accent hover:bg-accent-hover text-accent-text shrink-0 rounded-md px-2.5 py-1 text-base font-medium transition-colors"
            >
              Add to pi packages
            </button>
          </div>
        )}
        {adapterInstalled === false && packages !== null && (
          <div className="text-text-tertiary mt-1 text-sm">
            Adding it edits pi&apos;s settings.json; restart sessions to apply.
          </div>
        )}
      </div>

      {/* Servers */}
      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Configured servers</h3>
        <button
          onClick={() => setAdding(true)}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1 text-base font-medium transition-colors"
        >
          Add server…
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {configs?.servers.map((server) => (
          <ServerRow
            key={server.name}
            server={server}
            cache={cache.find((c) => c.name === server.name)}
            workspacePath={workspacePath ?? undefined}
            onToggle={(disabled) =>
              void act(() =>
                window.pidex.invoke(
                  'mcp:setDisabled',
                  server.scope,
                  workspacePath ?? undefined,
                  server.name,
                  disabled,
                ),
              )
            }
            onRemove={() =>
              void act(() =>
                window.pidex.invoke(
                  'mcp:removeServer',
                  server.scope,
                  workspacePath ?? undefined,
                  server.name,
                ),
              )
            }
            onEdit={() => setEditing(server)}
          />
        ))}
        {configs && configs.servers.length === 0 && (
          <div className="text-text-tertiary py-3 text-base">No MCP servers configured yet.</div>
        )}
      </div>

      {/* Config files */}
      <h3 className="mt-6 text-lg font-semibold">Config files</h3>
      <p className="text-text-tertiary mt-0.5 text-sm">
        Resolution order, lowest → highest — later files override earlier ones per server name.
      </p>
      <div className="border-border mt-2 divide-y rounded-lg border">
        {configs?.files.map((file) => (
          <div key={file.scope} className="flex items-center gap-2 px-3 py-1.5 text-base">
            <span className="text-text-secondary w-32 shrink-0">{SCOPE_LABELS[file.scope]}</span>
            <span
              className="text-text-tertiary min-w-0 flex-1 truncate font-mono text-sm"
              title={file.path}
            >
              {file.path}
            </span>
            {file.malformed ? (
              <span className="text-danger shrink-0 text-sm" title={file.error}>
                malformed
              </span>
            ) : file.exists ? (
              <span className="text-text-tertiary shrink-0 text-sm">
                {file.serverNames.length} server{file.serverNames.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="text-text-tertiary/60 shrink-0 text-sm">absent</span>
            )}
            <button
              onClick={() => setRawEdit(file.scope)}
              className="text-text-tertiary hover:text-text shrink-0 text-sm underline-offset-2 hover:underline"
            >
              Edit
            </button>
          </div>
        ))}
      </div>

      {error && <div className="text-danger mt-3 text-base">{error}</div>}

      {(adding || editing) && (
        <ServerEditor
          initial={editing}
          workspacePath={workspacePath ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSave={(scope, name, config) =>
            void act(async () => {
              await window.pidex.invoke(
                'mcp:upsertServer',
                scope,
                workspacePath ?? undefined,
                name,
                config,
              )
              setAdding(false)
              setEditing(null)
            })
          }
        />
      )}

      {rawEdit && (
        <RawFileEditor
          scope={rawEdit}
          workspacePath={workspacePath ?? undefined}
          onClose={() => {
            setRawEdit(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

/** Live-ish status: the adapter's setStatus line for the active session. */
function AdapterSessionStatus(): React.JSX.Element | null {
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const statuses = useExtensionUiStore((s) =>
    activeSessionId ? s.statuses[activeSessionId] : undefined,
  )
  const mcpStatus = useMemo(() => {
    for (const [key, text] of Object.entries(statuses ?? {})) {
      if (key.toLowerCase().includes('mcp') || stripAnsi(text).toLowerCase().includes('mcp')) {
        return stripAnsi(text)
      }
    }
    return null
  }, [statuses])

  if (!mcpStatus) return null
  return (
    <span className="text-text-tertiary text-sm" title="Reported by pi-mcp-adapter">
      · {mcpStatus}
    </span>
  )
}

function ServerRow({
  server,
  cache,
  onToggle,
  onRemove,
  onEdit,
}: {
  server: McpResolvedServer
  cache?: McpCacheEntry
  workspacePath?: string
  onToggle: (disabled: boolean) => void
  onRemove: () => void
  onEdit: () => void
}): React.JSX.Element {
  const [showTools, setShowTools] = useState(false)
  const disabled = server.config.disabled === true
  const transport = server.config.url
    ? server.config.url
    : [server.config.command, ...(server.config.args ?? [])].join(' ')

  return (
    <div className="border-border rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className={clsx('text-lg font-medium', disabled && 'text-text-tertiary line-through')}
        >
          {server.name}
        </span>
        <span
          className="bg-bg-secondary text-text-tertiary rounded px-1.5 py-px text-xs"
          title={`Defined in ${SCOPE_LABELS[server.scope]}`}
        >
          {SCOPE_LABELS[server.scope]}
        </span>
        <span
          className="text-text-tertiary min-w-0 flex-1 truncate font-mono text-sm"
          title={transport}
        >
          {transport}
        </span>
        <label className="flex shrink-0 items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={!disabled}
            onChange={(e) => onToggle(!e.target.checked)}
          />
          enabled
        </label>
        <button
          onClick={onEdit}
          className="text-text-tertiary hover:text-text shrink-0 text-sm underline-offset-2 hover:underline"
        >
          Edit
        </button>
        <button
          onClick={onRemove}
          className="text-text-tertiary hover:text-danger shrink-0 text-sm underline-offset-2 hover:underline"
        >
          Remove
        </button>
      </div>
      <div className="text-text-tertiary mt-1 flex items-center gap-2 text-sm">
        {cache && cache.tools.length > 0 && (
          <button onClick={() => setShowTools((s) => !s)} className="flex items-center gap-1">
            <ChevronIcon size={8} expanded={showTools} />
            {cache.tools.length} cached tool{cache.tools.length === 1 ? '' : 's'}
          </button>
        )}
        {(server.config.directTools?.length ?? 0) > 0 && (
          <span>
            direct:{' '}
            <span className="font-mono">{server.config.directTools!.slice(0, 4).join(', ')}</span>
            {server.config.directTools!.length > 4 && ` +${server.config.directTools!.length - 4}`}
          </span>
        )}
        {server.shadows.length > 0 && (
          <span title="Lower-precedence files also define this server">
            shadows {server.shadows.map((s) => SCOPE_LABELS[s]).join(', ')}
          </span>
        )}
      </div>
      {showTools && cache && (
        <div className="text-text-secondary mt-1 font-mono text-sm">{cache.tools.join(' · ')}</div>
      )}
    </div>
  )
}

function ServerEditor({
  initial,
  workspacePath,
  onClose,
  onSave,
}: {
  initial: McpResolvedServer | null
  workspacePath?: string
  onClose: () => void
  onSave: (scope: McpWriteScope, name: string, config: McpServerConfig) => void
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<'url' | 'command'>(initial?.config.command ? 'command' : 'url')
  const [url, setUrl] = useState(initial?.config.url ?? '')
  const [command, setCommand] = useState(
    [initial?.config.command, ...(initial?.config.args ?? [])].filter(Boolean).join(' '),
  )
  const [directTools, setDirectTools] = useState((initial?.config.directTools ?? []).join(', '))
  const editableScope: McpWriteScope =
    initial?.scope === 'pi-global' || initial?.scope === 'pi-project' ? initial.scope : 'pi-global'
  const [scope, setScope] = useState<McpWriteScope>(editableScope)

  const save = (): void => {
    const config: McpServerConfig = { ...(initial?.config ?? {}) }
    delete config.url
    delete config.command
    delete config.args
    if (kind === 'url') {
      config.url = url.trim()
    } else {
      const [cmd = '', ...args] = command.trim().split(/\s+/)
      config.command = cmd
      if (args.length) config.args = args
      else delete config.args
    }
    const tools = directTools
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tools.length) config.directTools = tools
    else delete config.directTools
    onSave(scope, name.trim(), config)
  }

  const input =
    'border-border bg-surface text-text placeholder:text-text-tertiary w-full rounded-md border px-2.5 py-1.5 text-base outline-none focus:border-[var(--px-border-strong)]'

  return (
    <div className="border-border bg-bg-secondary/40 mt-4 space-y-2 rounded-lg border p-3">
      <div className="text-lg font-semibold">
        {initial ? `Edit ${initial.name}` : 'Add MCP server'}
      </div>
      <input
        autoFocus={!initial}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={initial !== null}
        placeholder="server name (e.g. linear)"
        className={clsx(input, 'font-mono')}
      />
      <div className="flex items-center gap-3 text-base">
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === 'url'} onChange={() => setKind('url')} /> Remote URL
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === 'command'} onChange={() => setKind('command')} />{' '}
          Local command
        </label>
      </div>
      {kind === 'url' ? (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/sse"
          className={clsx(input, 'font-mono')}
        />
      ) : (
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npx some-mcp-server --flag"
          className={clsx(input, 'font-mono')}
        />
      )}
      <input
        value={directTools}
        onChange={(e) => setDirectTools(e.target.value)}
        placeholder="directTools (comma-separated, optional)"
        className={clsx(input, 'font-mono')}
      />
      {initial === null && (
        <div className="flex items-center gap-3 text-base">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={scope === 'pi-global'}
              onChange={() => setScope('pi-global')}
            />
            Global (~/.pi/agent)
          </label>
          <label className={clsx('flex items-center gap-1', !workspacePath && 'opacity-50')}>
            <input
              type="radio"
              disabled={!workspacePath}
              checked={scope === 'pi-project'}
              onChange={() => setScope('pi-project')}
            />
            This project (.pi/mcp.json)
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1 text-base font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!name.trim() || (kind === 'url' ? !url.trim() : !command.trim())}
          className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3 py-1 text-base font-medium transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}

/** Raw JSON escape hatch — the same last-resort editor Advanced offers. */
function RawFileEditor({
  scope,
  workspacePath,
  onClose,
}: {
  scope: McpScope
  workspacePath?: string
  onClose: () => void
}): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pidex.invoke('mcp:readFile', scope, workspacePath).then((file) => {
      setPath(file.path)
      setContent(file.content || '{\n  "mcpServers": {}\n}\n')
    })
  }, [scope, workspacePath])

  const save = async (): Promise<void> => {
    if (content === null) return
    setError(null)
    try {
      await window.pidex.invoke('mcp:writeFile', scope, workspacePath, content)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="border-border bg-bg-secondary/40 mt-4 rounded-lg border p-3">
      <div className="text-text-tertiary mb-2 truncate font-mono text-sm" title={path}>
        {path}
      </div>
      <textarea
        value={content ?? ''}
        onChange={(e) => setContent(e.target.value)}
        rows={12}
        spellCheck={false}
        className="border-border bg-code-bg text-text w-full resize-y rounded-lg border px-3 py-2 font-mono text-base outline-none"
      />
      {error && <div className="text-danger mt-1 text-base">{error}</div>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1 text-base font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3 py-1 text-base font-medium transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}
