import { useWorkspacesStore } from '@/stores/workspaces'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { SectionTitle } from '@/components/form'
import type { WorkspaceInfo } from '@shared/models'

/** Recent workspaces and per-workspace layout reset. */

export function WorkspacesTab(): React.JSX.Element {
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
        <p className="text-text-tertiary text-base">No recent workspaces.</p>
      )}
      <div className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {recents.map((workspace) => (
          <div key={workspace.path} className="bg-surface flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-medium">{workspace.name}</span>
              <span className="text-text-tertiary block truncate text-sm">{workspace.path}</span>
            </span>
            <button
              onClick={() => resetLayout(workspace)}
              className="border-border hover:bg-bg-secondary shrink-0 rounded-md border px-2 py-1 text-sm font-medium transition-colors"
            >
              Reset layout
            </button>
            <button
              onClick={() => void remove(workspace)}
              className="text-text-tertiary hover:text-danger shrink-0 rounded-md px-1.5 py-1 text-sm transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
