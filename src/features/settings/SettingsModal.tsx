import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { create } from 'zustand'
import type {
  AboutInfo,
  ConfigFileHealth,
  PiHealth,
  PiResources,
  WorkspaceInfo,
} from '@shared/models'
import { useSettingsStore } from '@/stores/settings'
import { useActiveWorkspace, useWorkspacesStore } from '@/stores/workspaces'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { MonacoEditor } from '@/features/files/MonacoEditor'
import { ModalOverlay } from '@/components/Modal'
import { CloseIcon } from '@/components/icons'

type SettingsTab = 'appearance' | 'agent' | 'workspaces' | 'advanced' | 'keybindings' | 'about'

interface SettingsUiState {
  open: boolean
  tab: SettingsTab
  setOpen: (open: boolean) => void
  setTab: (tab: SettingsTab) => void
}

export const useSettingsUiStore = create<SettingsUiState>((set) => ({
  open: false,
  tab: 'appearance',
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
}))

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'agent', label: 'Agent' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'about', label: 'About' },
]

export function SettingsModal(): React.JSX.Element | null {
  const open = useSettingsUiStore((s) => s.open)
  const tab = useSettingsUiStore((s) => s.tab)

  if (!open) return null
  const close = (): void => useSettingsUiStore.getState().setOpen(false)

  return (
    <ModalOverlay onClose={close} z={40}>
      <div className="border-border bg-bg flex h-[78vh] w-[880px] max-w-[94vw] overflow-hidden rounded-2xl border shadow-2xl">
        <aside className="border-border bg-bg-secondary/50 w-52 shrink-0 border-r px-3 py-4">
          <div className="text-text-tertiary px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider">
            Settings
          </div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => useSettingsUiStore.getState().setTab(t.id)}
              className={clsx(
                'mb-0.5 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                tab === t.id
                  ? 'bg-bg-secondary text-text font-medium'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </aside>

        <div className="relative min-w-0 flex-1 overflow-y-auto px-7 py-6">
          <button
            onClick={close}
            className="text-text-tertiary hover:text-text absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            <CloseIcon size={14} />
          </button>
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'agent' && <AgentTab />}
          {tab === 'workspaces' && <WorkspacesTab />}
          {tab === 'advanced' && <AdvancedTab />}
          {tab === 'keybindings' && <KeybindingsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------- Appearance ----------

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

function AppearanceTab(): React.JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const fonts = useSettingsStore((s) => s.fonts)
  const setFonts = useSettingsStore((s) => s.setFonts)

  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>

      <Row title="Theme" description="Applies live across chat, editor, terminal and diagrams.">
        <div
          className="border-border flex overflow-hidden rounded-lg border"
          role="group"
          aria-label="Theme"
        >
          {THEME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => useSettingsStore.getState().setTheme(value)}
              className={clsx(
                'px-3 py-1.5 text-[12px] font-medium transition-colors',
                theme === value
                  ? 'bg-accent text-accent-text'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Row title="UI scale" description="Overall interface size.">
        <NumberField
          value={Math.round(fonts.uiScale * 100)}
          suffix="%"
          min={80}
          max={140}
          step={5}
          onChange={(v) => setFonts({ uiScale: v / 100 })}
        />
      </Row>
      <Row title="Chat font size" description="Message text size in the conversation.">
        <NumberField
          value={fonts.chatFontSize}
          suffix="px"
          min={11}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ chatFontSize: v })}
        />
      </Row>
      <Row
        title="Editor font size"
        description="Monaco editor and diffs. Applies to newly opened editors."
      >
        <NumberField
          value={fonts.editorFontSize}
          suffix="px"
          min={10}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ editorFontSize: v })}
        />
      </Row>
      <Row title="Terminal font size" description="Applies to new terminal tabs.">
        <NumberField
          value={fonts.terminalFontSize}
          suffix="px"
          min={10}
          max={20}
          step={0.5}
          onChange={(v) => setFonts({ terminalFontSize: v })}
        />
      </Row>
      <Row title="Mono font" description="Used for code, diffs and the terminal.">
        <select
          value={fonts.monoFont}
          onChange={(e) => setFonts({ monoFont: e.target.value })}
          className="border-border bg-surface text-text rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
        >
          {['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Cascadia Code', 'monospace'].map(
            (font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ),
          )}
        </select>
      </Row>
    </div>
  )
}

// ---------- Agent (writes pi settings.json) ----------

function AgentTab(): React.JSX.Element {
  const currentWorkspace = useActiveWorkspace()
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [health, setHealth] = useState<ConfigFileHealth | null>(null)
  const [saving, setSaving] = useState(false)

  const workspaceArg = scope === 'project' ? (currentWorkspace ?? undefined) : undefined

  const reload = useCallback((): void => {
    void window.pidex.invoke('pi:agentSettings', workspaceArg).then(setSettings)
    void window.pidex.invoke('pi:checkAgentSettings', workspaceArg).then((result) => {
      setHealth(
        scope === 'global'
          ? result.global
          : (result.project ?? { exists: false, malformed: false }),
      )
    })
  }, [workspaceArg, scope])

  useEffect(() => reload(), [reload])

  const patch = async (partial: Record<string, unknown>): Promise<void> => {
    setSaving(true)
    try {
      await window.pidex.invoke('pi:patchAgentSettings', scope, workspaceArg, partial)
      setSettings((s) => ({ ...(s ?? {}), ...partial }))
      useExtensionUiStore.getState().pushToast('Saved — applies to newly started sessions', 'info')
    } catch (error) {
      // Malformed existing config: main refuses to write rather than clobber it.
      useExtensionUiStore.getState().pushToast((error as Error).message, 'error')
      reload()
    } finally {
      setSaving(false)
    }
  }

  const blocked = health?.malformed === true

  const compaction = (settings?.compaction ?? {}) as Record<string, unknown>
  const retry = (settings?.retry ?? {}) as Record<string, unknown>

  return (
    <div>
      <SectionTitle>Agent defaults</SectionTitle>
      <p className="text-text-tertiary -mt-2 mb-4 text-[12px]">
        Writes pi&apos;s <code className="font-mono">settings.json</code>. Changes apply to{' '}
        <b>new</b> sessions (pi reads config at spawn).{saving ? ' Saving…' : ''}
      </p>

      {blocked && (
        <div className="bg-danger-soft border-danger/30 mb-4 rounded-lg border px-3.5 py-3 text-[12.5px]">
          <div className="text-danger font-medium">
            This {scope === 'global' ? 'global' : 'workspace'} settings.json is not valid JSON.
          </div>
          <div className="text-text-secondary mt-1 leading-relaxed">
            Editing is disabled so pidex cannot overwrite and lose your existing configuration. pi
            also ignores the broken file and falls back to its defaults.
            {health?.error ? ` (${health.error})` : ''}
          </div>
          <button
            onClick={() => useSettingsUiStore.getState().setTab('advanced')}
            className="border-danger/40 text-danger hover:bg-danger/10 mt-2 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
          >
            Fix it in Advanced →
          </button>
        </div>
      )}

      {/* Scope stays enabled even when a file is broken, so you can inspect
          the other scope. */}
      <Row
        title="Scope"
        description="Global (~/.pi/agent) or an override for this workspace (.pi/settings.json)."
      >
        <div
          className="border-border flex overflow-hidden rounded-lg border"
          role="group"
          aria-label="Settings scope"
        >
          {(
            [
              { value: 'global', label: 'Global' },
              { value: 'project', label: 'Project' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              aria-pressed={scope === value}
              disabled={value === 'project' && !currentWorkspace}
              onClick={() => setScope(value)}
              className={clsx(
                'px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40',
                scope === value
                  ? 'bg-accent text-accent-text'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>

      <fieldset
        disabled={blocked}
        className={clsx('contents', blocked && 'pointer-events-none opacity-50')}
      >
        <Row title="Default model" description='e.g. "claude-sonnet-4-5" or a models.json id.'>
          <TextField
            defaultValue={(settings?.defaultModel as string) ?? ''}
            placeholder="(pi default)"
            onCommit={(v) => void patch({ defaultModel: v || undefined })}
          />
        </Row>
        <Row
          title="Default provider"
          description='e.g. "anthropic", "openai", or a custom provider.'
        >
          <TextField
            defaultValue={(settings?.defaultProvider as string) ?? ''}
            placeholder="(pi default)"
            onCommit={(v) => void patch({ defaultProvider: v || undefined })}
          />
        </Row>
        <Row
          title="Default thinking level"
          description="off · minimal · low · medium · high · xhigh"
        >
          <select
            value={(settings?.defaultThinkingLevel as string) ?? ''}
            onChange={(e) => void patch({ defaultThinkingLevel: e.target.value || undefined })}
            className="border-border bg-surface text-text rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
          >
            <option value="">(pi default)</option>
            {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </Row>
        <Row
          title="Hide thinking blocks"
          description="Collapse model reasoning out of the transcript."
        >
          <Toggle
            on={settings?.hideThinkingBlock === true}
            onChange={(on) => void patch({ hideThinkingBlock: on })}
          />
        </Row>
        <Row title="Steering delivery" description="How queued steering messages are injected.">
          <ModeSelect
            value={(settings?.steeringMode as string) ?? ''}
            onChange={(v) => void patch({ steeringMode: v || undefined })}
          />
        </Row>
        <Row title="Follow-up delivery" description="How queued follow-ups are injected.">
          <ModeSelect
            value={(settings?.followUpMode as string) ?? ''}
            onChange={(v) => void patch({ followUpMode: v || undefined })}
          />
        </Row>

        <SectionTitle small>Compaction</SectionTitle>
        <Row
          title="Auto-compaction"
          description="Compact context automatically near the window limit."
        >
          <Toggle
            on={compaction.enabled !== false}
            onChange={(on) => void patch({ compaction: { ...compaction, enabled: on } })}
          />
        </Row>
        <Row title="Reserve tokens" description="Headroom kept free for the model's response.">
          <NumberField
            value={Number(compaction.reserveTokens ?? 16384)}
            min={1024}
            max={131072}
            step={1024}
            onChange={(v) => void patch({ compaction: { ...compaction, reserveTokens: v } })}
          />
        </Row>
        <Row
          title="Keep recent tokens"
          description="Recent conversation preserved verbatim during compaction."
        >
          <NumberField
            value={Number(compaction.keepRecentTokens ?? 20000)}
            min={1024}
            max={131072}
            step={1024}
            onChange={(v) => void patch({ compaction: { ...compaction, keepRecentTokens: v } })}
          />
        </Row>

        <SectionTitle small>Auto-retry</SectionTitle>
        <Row
          title="Retry on transient errors"
          description="Overloaded / rate-limit / 5xx responses."
        >
          <Toggle
            on={retry.enabled !== false}
            onChange={(on) => void patch({ retry: { ...retry, enabled: on } })}
          />
        </Row>
        <Row title="Max retries" description="Attempts before giving up.">
          <NumberField
            value={Number(retry.maxRetries ?? 3)}
            min={1}
            max={10}
            step={1}
            onChange={(v) => void patch({ retry: { ...retry, maxRetries: v } })}
          />
        </Row>
        <Row title="Base delay (ms)" description="First retry delay; grows exponentially.">
          <NumberField
            value={Number(retry.baseDelayMs ?? 2000)}
            min={250}
            max={60000}
            step={250}
            onChange={(v) => void patch({ retry: { ...retry, baseDelayMs: v } })}
          />
        </Row>
      </fieldset>
    </div>
  )
}

function ModeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-border bg-surface text-text rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
    >
      <option value="">(pi default)</option>
      <option value="one-at-a-time">one-at-a-time</option>
      <option value="all">all</option>
    </select>
  )
}

// ---------- Workspaces ----------

function WorkspacesTab(): React.JSX.Element {
  const recents = useWorkspacesStore((s) => s.recents)

  const remove = async (workspace: WorkspaceInfo): Promise<void> => {
    const next = recents.filter((w) => w.path !== workspace.path)
    await window.pidex.invoke('app:setRecentWorkspaces', next)
    useWorkspacesStore.setState({ recents: next })
  }

  const resetLayout = (workspace: WorkspaceInfo): void => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes(workspace.path)) localStorage.removeItem(key)
    }
    useExtensionUiStore.getState().pushToast(`Layout reset for ${workspace.name}`, 'info')
  }

  return (
    <div>
      <SectionTitle>Workspaces</SectionTitle>
      {recents.length === 0 && (
        <p className="text-text-tertiary text-[12.5px]">No recent workspaces.</p>
      )}
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {recents.map((workspace) => (
          <div key={workspace.path} className="bg-surface flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{workspace.name}</span>
              <span className="text-text-tertiary block truncate text-[11px]">
                {workspace.path}
              </span>
            </span>
            <button
              onClick={() => resetLayout(workspace)}
              className="border-border hover:bg-bg-secondary shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
            >
              Reset layout
            </button>
            <button
              onClick={() => void remove(workspace)}
              className="text-text-tertiary hover:text-danger shrink-0 rounded-md px-1.5 py-1 text-[11px] transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Advanced ----------

function AdvancedTab(): React.JSX.Element {
  const [health, setHealth] = useState<PiHealth | null>(null)
  const [resources, setResources] = useState<PiResources | null>(null)
  const [editing, setEditing] = useState<'settings' | 'models' | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:health').then(setHealth)
    void window.pidex.invoke('pi:listResources').then(setResources)
  }, [])

  return (
    <div>
      <SectionTitle>Advanced</SectionTitle>

      <Row
        title="pi health"
        description={
          health
            ? `${health.binaryPath ?? 'not found'} — minimum supported ${health.minVersion}`
            : 'checking…'
        }
      >
        <span
          className={clsx(
            'rounded-md px-2 py-1 font-mono text-[11.5px] font-medium',
            health?.ok ? 'bg-success/15 text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {health ? (health.ok ? `v${health.version}` : (health.reason ?? 'error')) : '…'}
        </span>
      </Row>

      <Row
        title="pi settings.json"
        description="Raw editor for ~/.pi/agent/settings.json. Restart sessions to apply."
      >
        <button
          onClick={() => setEditing('settings')}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
        >
          Edit…
        </button>
      </Row>
      <Row
        title="pi models.json"
        description="Custom providers and models (local endpoints live here)."
      >
        <button
          onClick={() => setEditing('models')}
          className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
        >
          Edit…
        </button>
      </Row>

      <SectionTitle small>Discovered pi resources</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {(['skills', 'extensions', 'prompts'] as const).map((kind) => (
          <div key={kind} className="border-border bg-surface rounded-xl border p-3">
            <div className="text-text-tertiary text-[10.5px] font-semibold uppercase tracking-wider">
              {kind}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {(resources?.[kind] ?? []).slice(0, 8).map((name) => (
                <div key={name} className="truncate font-mono text-[11.5px]">
                  {name}
                </div>
              ))}
              {resources && resources[kind].length === 0 && (
                <div className="text-text-tertiary text-[11.5px]">none</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-text-tertiary mt-3 text-[11px]">
        auth.json is never read or displayed by pidex.
      </p>

      {editing && <ConfigFileEditor name={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ConfigFileEditor({
  name,
  onClose,
}: {
  name: 'settings' | 'models'
  onClose: () => void
}): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pidex.invoke('pi:readConfigFile', name).then((file) => {
      setContent(file.content || '{\n}\n')
      setPath(file.path)
    })
  }, [name])

  const save = async (): Promise<void> => {
    if (content === null) return
    try {
      await window.pidex.invoke('pi:writeConfigFile', name, content)
      useExtensionUiStore
        .getState()
        .pushToast(`${name}.json saved — restart sessions to apply`, 'info')
      onClose()
    } catch (err) {
      setError(`Invalid JSON: ${(err as Error).message}`)
    }
  }

  return (
    <ModalOverlay onClose={onClose} backdrop="strong" z={50}>
      <div className="border-border bg-bg flex h-[70vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border flex items-center gap-2 border-b px-4 py-2.5">
          <span className="flex-1 truncate font-mono text-[12px]">{path}</span>
          {error && <span className="text-danger text-[11.5px]">{error}</span>}
          <button
            onClick={onClose}
            className="border-border hover:bg-bg-secondary rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3 py-1 text-[12px] font-medium transition-colors"
          >
            Save
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {content !== null && (
            <MonacoEditor
              path={`pi-config://${name}.json`}
              language="json"
              value={content}
              onChange={setContent}
              onSave={() => void save()}
            />
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

// ---------- Keybindings ----------

const KEYBINDINGS: Array<[string, string]> = [
  ['⌘/Ctrl + N', 'New session'],
  ['⌘/Ctrl + B', 'Toggle sidebar'],
  ['⌘/Ctrl + P', 'Go to file'],
  ['⌘/Ctrl + K', 'Command palette'],
  ['⌘/Ctrl + ,', 'Settings'],
  ['⌘/Ctrl + `', 'Toggle terminal pane'],
  ['⌘/Ctrl + ⇧ + E', 'Toggle files pane'],
  ['⌘/Ctrl + ⇧ + G', 'Toggle changes pane'],
  ['Enter', 'Send prompt (steer while streaming)'],
  ['⌥/⌘ + Enter', 'Queue follow-up while streaming'],
  ['Esc', 'Stop the agent / close overlays'],
  ['⇧ + Enter', 'Newline in composer'],
  ['⌘/Ctrl + S', 'Save file in editor'],
  ['⌘/Ctrl + F', 'Search in terminal'],
]

function KeybindingsTab(): React.JSX.Element {
  return (
    <div>
      <SectionTitle>Keybindings</SectionTitle>
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {KEYBINDINGS.map(([keys, action]) => (
          <div key={keys} className="bg-surface flex items-center justify-between px-4 py-2">
            <span className="text-[12.5px]">{action}</span>
            <kbd className="bg-bg-secondary border-border rounded-md border px-2 py-0.5 font-mono text-[11px]">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- About ----------

/** Newest pi minor pidex has been verified against (drift warning source). */
const VERIFIED_PI_MINOR = 78

function AboutTab(): React.JSX.Element {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [health, setHealth] = useState<PiHealth | null>(null)

  useEffect(() => {
    void window.pidex.invoke('app:about').then(setAbout)
    void window.pidex.invoke('pi:health').then(setHealth)
  }, [])

  const piMinor = health?.version ? Number(health.version.split('.')[1] ?? 0) : null
  const drift = piMinor !== null && piMinor > VERIFIED_PI_MINOR

  return (
    <div>
      <SectionTitle>About pidex</SectionTitle>
      <p className="text-text-secondary -mt-2 mb-4 text-[12.5px] leading-relaxed">
        A desktop coding-agent app powered by the{' '}
        <span className="font-medium">pi coding agent</span>. Sessions run as real{' '}
        <code className="font-mono">pi --mode rpc</code> subprocesses in your workspace.
      </p>

      <Row title="pidex version">
        <span className="font-mono text-[12.5px]">{about?.appVersion ?? '…'}</span>
      </Row>
      <Row title="pi version" description={health?.binaryPath}>
        <span className="font-mono text-[12.5px]">
          {health?.version ?? (health ? 'not found' : '…')}
        </span>
      </Row>
      <Row title="Platform">
        <span className="font-mono text-[12.5px]">
          {about ? `${about.platform}-${about.arch}` : '…'}
        </span>
      </Row>
      <Row title="Runtime">
        <span className="font-mono text-[12.5px]">
          {about ? `Electron ${about.electron} · Node ${about.node}` : '…'}
        </span>
      </Row>

      {drift && (
        <div className="bg-warning/10 border-warning/30 mt-4 rounded-lg border px-3.5 py-2.5 text-[12.5px]">
          <span className="font-medium">pi {health?.version} is newer than tested.</span>{' '}
          <span className="text-text-secondary">
            pidex is verified against pi 0.{VERIFIED_PI_MINOR}.x. Newer minors usually work, but
            protocol additions may not be surfaced yet.
          </span>
        </div>
      )}
    </div>
  )
}

// ---------- shared bits ----------

function SectionTitle({
  children,
  small,
}: {
  children: React.ReactNode
  small?: boolean
}): React.JSX.Element {
  return (
    <h2 className={clsx('font-semibold', small ? 'mb-2 mt-6 text-[13px]' : 'mb-4 text-[16px]')}>
      {children}
    </h2>
  )
}

function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="border-border flex items-center justify-between gap-6 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {description && (
          <div className="text-text-tertiary mt-0.5 text-[11.5px] leading-snug">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-[22px] w-10 rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all',
          on ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  suffix?: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="border-border bg-surface text-text w-24 rounded-lg border px-2.5 py-1.5 text-right text-[12.5px] outline-none"
      />
      {suffix && <span className="text-text-tertiary text-[11.5px]">{suffix}</span>}
    </span>
  )
}

function TextField({
  defaultValue,
  placeholder,
  onCommit,
}: {
  defaultValue: string
  placeholder?: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(defaultValue)
  useEffect(() => setValue(defaultValue), [defaultValue])
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== defaultValue) onCommit(value.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="border-border bg-surface text-text placeholder:text-text-tertiary w-56 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
    />
  )
}
