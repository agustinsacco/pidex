import { useEffect, useRef, useState } from 'react'
import type { GitInfo, WorktreeInfo } from '@shared/models'
import { BranchIcon } from '@/components/icons'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { useSessionsStore } from '@/stores/sessions'
import { useWorkspacesStore } from '@/stores/workspaces'
import { MergeWorktreeModal } from '@/features/worktrees/MergeWorktreeModal'
import { RemoveWorktreeModal } from '@/features/worktrees/RemoveWorktreeModal'
import { WorktreeMenu } from '@/features/worktrees/WorktreeMenu'
import { PrRow } from '@/features/worktrees/PrRow'
import { workspaceName } from '@/lib/path'

/** Branch and dirty-count chips in the chat header, refreshed on fs changes. */

export function GitChips({ workspacePath }: { workspacePath: string }): React.JSX.Element | null {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [mergeTarget, setMergeTarget] = useState<WorktreeInfo | null>(null)
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      void window.pidex.invoke('git:info', workspacePath).then(setInfo)
    }
    refresh()
    void window.pidex.invoke('fs:watchWorkspace', workspacePath)
    const unsubscribe = window.pidex.onFsChanged((payload) => {
      if (payload.workspacePath !== workspacePath) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 500)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [workspacePath])

  if (!info?.isRepo || !info.branch) return null

  // In a worktree the repo of record is the main tree; in the main tree it is
  // this workspace. Either way the menu below operates on the same repo, which
  // is what makes main -> worktree and worktree -> main both reachable from
  // inside a session rather than only from the home screen.
  const mainRepo = info.mainRepoPath
  const repoPath = info.isWorktree && mainRepo ? mainRepo : workspacePath

  const openWorkspaceAt = (cwd: string): void => {
    setOpen(false)
    useWorkspacesStore.getState().openWorkspace(cwd)
    useSessionsStore.getState().activate(null)
  }

  const openMergeModal = async (): Promise<void> => {
    if (!mainRepo) return
    setOpen(false)
    const worktrees = await window.pidex.invoke('git:listWorktrees', mainRepo)
    const here = worktrees.find((w) => w.path === workspacePath || w.realPath === workspacePath)
    if (here) setMergeTarget(here)
  }

  return (
    <span className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title={info.isWorktree && mainRepo ? `Worktree of ${mainRepo}` : `Branch ${info.branch}`}
        className="bg-bg-secondary text-text-secondary hover:text-text flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] transition-colors"
      >
        {info.isWorktree && (
          <span className="bg-accent-soft text-accent rounded px-1 text-[9.5px] font-medium">
            wt
          </span>
        )}
        <BranchIcon size={10} />
        <span className="max-w-36 truncate">{info.branch}</span>
        {(info.ahead ?? 0) > 0 && <span className="text-success">↑{info.ahead}</span>}
        {(info.behind ?? 0) > 0 && <span className="text-info">↓{info.behind}</span>}
        {(info.dirtyCount ?? 0) > 0 && <span className="text-warning">·{info.dirtyCount}</span>}
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute left-0 top-full z-40 mt-1.5 w-64 py-1.5"
        >
          <div className="px-3 pb-1.5 pt-1">
            <div className="text-text truncate text-[13px] font-medium">{info.branch}</div>
            <div className="text-text-secondary mt-0.5 text-[12px]">
              {(info.dirtyCount ?? 0) > 0
                ? `${info.dirtyCount} uncommitted change${info.dirtyCount === 1 ? '' : 's'}`
                : 'Working tree clean'}
              {info.isWorktree && mainRepo && ` · worktree of ${workspaceName(mainRepo)}`}
            </div>
          </div>
          <PrRow repoPath={repoPath} branch={info.branch} />
          <div className="border-border my-1 border-t" />

          <div className="text-text-tertiary px-3 pb-0.5 pt-1 text-[11px]">Switch workspace to</div>
          <WorktreeMenu
            repoPath={repoPath}
            currentCwd={info.isWorktree ? workspacePath : null}
            mainBranch={info.isWorktree ? undefined : info.branch}
            onSelectMain={() => openWorkspaceAt(repoPath)}
            onSelectWorktree={(wt) => openWorkspaceAt(wt.realPath)}
            onRemove={(wt) => {
              setOpen(false)
              setRemoveTarget(wt)
            }}
          />

          {info.isWorktree && mainRepo && (
            <MenuRow active={false} onClick={() => void openMergeModal()}>
              <span className="text-[13px]">Merge into main repo…</span>
            </MenuRow>
          )}
          <MenuRow
            active={false}
            onClick={() => {
              setOpen(false)
              void window.pidex.invoke('app:revealPath', workspacePath)
            }}
          >
            <span className="text-[13px]">Reveal in file manager</span>
          </MenuRow>
        </PopupMenu>
      )}

      {removeTarget && (
        <RemoveWorktreeModal
          repoPath={repoPath}
          worktree={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            // The session's own worktree just went away; fall back to the repo.
            if (removeTarget.realPath === workspacePath) openWorkspaceAt(repoPath)
          }}
        />
      )}

      {mergeTarget && mainRepo && (
        <MergeWorktreeModal
          repoPath={mainRepo}
          worktree={mergeTarget}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </span>
  )
}
