import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ModalOverlay } from '@/components/Modal'
import { CloseIcon } from '@/components/icons'
import { useSettingsUiStore, type SettingsTab } from './settingsUiStore'
import { AppearanceTab } from './tabs/AppearanceTab'
import { AgentTab } from './tabs/AgentTab'
import { ExtensionsTab } from './tabs/ExtensionsTab'
import { ClaudeProviderTab } from './tabs/ClaudeProviderTab'
import { WorkspacesTab } from './tabs/WorkspacesTab'
import { AdvancedTab } from './tabs/AdvancedTab'
import { McpTab } from './tabs/McpTab'
import { KeybindingsTab } from './tabs/KeybindingsTab'
import { AboutTab } from './tabs/AboutTab'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'agent', label: 'Agent' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'about', label: 'About' },
]

/** Curated extensions contribute a tab only while their package is present. */
const EXTENSION_TABS: Array<{ id: SettingsTab; label: string; packageMatch: string }> = [
  { id: 'claude-provider', label: 'Claude Code', packageMatch: 'pi-claude-cli' },
]

/** Settings modal shell: sidebar tab list plus the active tab's panel. */
export function SettingsModal(): React.JSX.Element | null {
  const open = useSettingsUiStore((s) => s.open)
  const tab = useSettingsUiStore((s) => s.tab)
  const [installedSpecs, setInstalledSpecs] = useState<string[]>([])

  // Refresh on every open: installing from the Extensions tab should make
  // the extension's own tab appear without reopening the app.
  useEffect(() => {
    if (!open) return
    void window.pidex
      .invoke('packages:list')
      .then((entries) => setInstalledSpecs(entries.map((e) => e.spec)))
      .catch(() => setInstalledSpecs([]))
  }, [open, tab])

  if (!open) return null
  const close = (): void => useSettingsUiStore.getState().setOpen(false)

  const extensionTabs = EXTENSION_TABS.filter((t) =>
    installedSpecs.some((spec) => spec.includes(t.packageMatch)),
  )
  const visibleTabs = [...TABS.slice(0, 3), ...extensionTabs, ...TABS.slice(3)]

  return (
    <ModalOverlay onClose={close} z={40}>
      <div className="border-border bg-bg flex h-[78vh] w-[880px] max-w-[94vw] overflow-hidden rounded-2xl border shadow-2xl">
        <aside className="border-border bg-bg-secondary/50 w-52 shrink-0 border-r px-3 py-4">
          <div className="text-text-tertiary px-2 pb-2 text-sm font-semibold font-mono uppercase tracking-wider">
            Settings
          </div>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => useSettingsUiStore.getState().setTab(t.id)}
              className={clsx(
                'mb-0.5 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-lg transition-colors',
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
          {tab === 'extensions' && <ExtensionsTab />}
          {tab === 'claude-provider' && <ClaudeProviderTab />}
          {tab === 'mcp' && <McpTab />}
          {tab === 'workspaces' && <WorkspacesTab />}
          {tab === 'advanced' && <AdvancedTab />}
          {tab === 'keybindings' && <KeybindingsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </ModalOverlay>
  )
}
