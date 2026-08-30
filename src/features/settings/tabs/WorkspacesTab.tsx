import { useWorkspacesStore } from '@/stores/workspaces'
import { useExtensionUiStore } from '@/stores/extensionUi'
import { useWorktreesStore } from '@/stores/worktrees'
import { Button, NumberField, Row, SectionTitle, TextField, Toggle } from '@/components/form'
import { normalizePrefix, slugifyTitle } from '@shared/branchName'
import { useLanePrefsStore } from '@/stores/lanePrefs'
import { LANE_PREF_LIMITS, type WorkspaceInfo } from '@shared/models'

/** How new chats get their branch, plus recent workspaces and layout reset. */

export function WorkspacesTab(): React.JSX.Element {
  const recents = useWorkspacesStore((s) => s.recents)
  const preferWorktree = useWorktreesStore((s) => s.preferWorktree)
  const branchPrefix = useWorktreesStore((s) => s.branchPrefix)
  const lanes = useLanePrefsStore((s) => s.lanes)
  const setLanePrefs = useLanePrefsStore((s) => s.setLanePrefs)

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
  // Show the cap doing its job on a realistic title rather than describing it.
  const exampleSlug = `${examplePrefix}${slugifyTitle(
    'Fix the composer autogrow jump on paste',
    lanes.branchSlugMaxLength,
  )}`

  return (
    <div>
      <SectionTitle>Naming and markers</SectionTitle>
      <div className="border-border bg-surface mb-2 rounded-xl border px-4">
        <Row
          title="Name sessions automatically"
          description="A one-shot model call titles a chat from its first message, and renames its branch to match. Off keeps the first message as the title and leaves the branch alone."
        >
          <Toggle on={lanes.autoName} onChange={(on) => setLanePrefs({ autoName: on })} />
        </Row>
        <Row
          title="Title length"
          description={
            lanes.nameMinWords === lanes.nameMaxWords
              ? `The namer is asked for exactly ${lanes.nameMinWords} word${lanes.nameMinWords === 1 ? '' : 's'}.`
              : `The namer is asked for ${lanes.nameMinWords}-${lanes.nameMaxWords} words.`
          }
        >
          <span className="flex items-center gap-2">
            <NumberField
              value={lanes.nameMinWords}
              min={LANE_PREF_LIMITS.nameWords.min}
              max={LANE_PREF_LIMITS.nameWords.max}
              step={1}
              onChange={(value) => setLanePrefs({ nameMinWords: value })}
            />
            <span className="text-text-tertiary text-sm">to</span>
            <NumberField
              value={lanes.nameMaxWords}
              min={LANE_PREF_LIMITS.nameWords.min}
              max={LANE_PREF_LIMITS.nameWords.max}
              step={1}
              onChange={(value) => setLanePrefs({ nameMaxWords: value })}
              suffix="words"
            />
          </span>
        </Row>
        <Row
          title="Title character limit"
          description="A hard cap applied after the model replies, so a long-winded title cannot stretch the sidebar."
        >
          <NumberField
            value={lanes.nameMaxLength}
            min={LANE_PREF_LIMITS.nameMaxLength.min}
            max={LANE_PREF_LIMITS.nameMaxLength.max}
            step={4}
            onChange={(value) => setLanePrefs({ nameMaxLength: value })}
            suffix="chars"
          />
        </Row>
        <Row
          title="Branch name length"
          description={`Capped separately from the title: a slug is read in git output and in a path. "${exampleSlug}"`}
        >
          <NumberField
            value={lanes.branchSlugMaxLength}
            min={LANE_PREF_LIMITS.branchSlugMaxLength.min}
            max={LANE_PREF_LIMITS.branchSlugMaxLength.max}
            step={4}
            onChange={(value) => setLanePrefs({ branchSlugMaxLength: value })}
            suffix="chars"
          />
        </Row>
        <Row
          title="Lane markers"
          description="The emoji left of each lane in the sidebar. Auto derives one from the branch name; Manual shows only the ones you pick; Off removes the column."
        >
          <span className="flex items-center gap-1">
            {(['auto', 'manual', 'off'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setLanePrefs({ markers: mode })}
                className={
                  lanes.markers === mode
                    ? 'border-accent/40 bg-accent-soft text-accent rounded-md border px-2.5 py-1 text-sm font-medium capitalize'
                    : 'border-border text-text-secondary hover:text-text rounded-md border px-2.5 py-1 text-sm capitalize'
                }
              >
                {mode}
              </button>
            ))}
          </span>
        </Row>
      </div>

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
