import { useWorkspacesStore } from '@/stores/workspaces'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { useWorktreesStore } from '@/stores/worktrees'
import { Button, Row, SectionTitle, TextField, Toggle } from '@/components/form'
import { normalizePrefix } from '@/lib/branchName'
import type { WorkspaceInfo } from '@shared/models'

/** How new chats get their branch, plus recent workspaces and layout reset. */

export function WorkspacesTab(): React.JSX.Element {
  const recents = useWorkspacesStore((s) => s.recents)
  const preferWorktree = useWorktreesStore((s) => s.preferWorktree)
  const branchPrefix = useWorktreesStore((s) => s.branchPrefix)

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

  // Show what the branch will actually look like, since the prefix is
  // normalized (a bare "pidex" becomes "pidex/") before it is ever used.
  const examplePrefix = normalizePrefix(branchPrefix)

  return (
    <div>
      <SectionTitle>New sessions</SectionTitle>
      <div className="border-border bg-surface mb-2 rounded-xl border px-4">
        <Row
          title="Give each chat its own branch"
          description="A new chat is named from its first message, then branched off the latest main into its own worktree. The same switch as the “worktree” checkbox in the branch menu."
        >
          <Toggle
            on={preferWorktree}
            onChange={(on) => useWorktreesStore.getState().setPreferWorktree(on)}
          />
        </Row>
        <Row
          title="Branch prefix"
          description={
            examplePrefix
              ? `Branches are named ${examplePrefix}session-title. Leave empty for no prefix.`
              : 'Branches are named after the session title, with no prefix.'
          }
        >
          <TextField
            defaultValue={branchPrefix}
            placeholder="pidex/"
            onCommit={(value) => useWorktreesStore.getState().setBranchPrefix(value)}
          />
        </Row>
      </div>

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
            <Button size="xs" onClick={() => resetLayout(workspace)} className="shrink-0">
              Reset layout
            </Button>
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
