import { useMemo, useState } from 'react'
import type { WorktreeInfo } from '@shared/models'
import { ModalOverlay } from '@/components/Modal'
import { useSessionsStore } from '@/stores/sessions'
import { useWorktreesStore } from '@/stores/worktrees'
import { workspaceName } from '@/lib/path'

/**
 * Remove a linked worktree with the safety ladder: live-session guard →
 * clean removal → explicit "discard N changes" checkbox before force.
 * Branch deletion is offered but only ever `git branch -d` (unmerged
 * branches survive and the error is shown).
 */
export function RemoveWorktreeModal({
  repoPath,
  worktree,
  onClose,
  onRemoved,
}: {
  repoPath: string
  worktree: WorktreeInfo
  onClose: () => void
  onRemoved?: () => void
}): React.JSX.Element {
  const live = useSessionsStore((s) => s.live)
  const [dirtyCount, setDirtyCount] = useState<number>(Math.max(0, worktree.dirtyCount))
  const [discard, setDiscard] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchNote, setBranchNote] = useState<string | null>(null)

  const liveHere = useMemo(
    () =>
      Object.values(live).some(
        (entry) =>
          entry.workspacePath === worktree.path || entry.workspacePath === worktree.realPath,
      ),
    [live, worktree],
  )

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await useWorktreesStore.getState().removeWorktree(repoPath, worktree.path, {
        force: dirtyCount > 0 && discard,
        deleteBranch,
      })
      if (!result.removed) {
        // Freshly dirty (or dirtier than we thought) — surface and require
        // the discard checkbox.
        setDirtyCount(result.dirtyCount)
        setDiscard(false)
        return
      }
      if (result.branchError) {
        setBranchNote(`Worktree removed. Branch kept: ${result.branchError}`)
        return
      }
      onRemoved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="border-border bg-surface-raised w-[440px] max-w-[92vw] overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border border-b px-4 py-3">
          <div className="text-[13.5px] font-semibold">Remove worktree</div>
          <div className="text-text-tertiary mt-0.5 truncate text-[11px]" title={worktree.path}>
            {workspaceName(worktree.path)}
            {worktree.branch ? ` — ${worktree.branch}` : ''}
          </div>
        </div>

        <div className="space-y-3 px-4 py-3 text-[13px]">
          {liveHere && (
            <div className="bg-warning/10 border-warning/30 text-text rounded-lg border px-3 py-2 text-[12.5px]">
              A live session is running in this worktree. Close it from the sidebar first.
            </div>
          )}

          {branchNote ? (
            <div className="text-text-secondary text-[12.5px]">{branchNote}</div>
          ) : dirtyCount > 0 ? (
            <div className="bg-danger-soft border-danger/25 rounded-lg border px-3 py-2.5">
              <div className="text-danger text-[12.5px] font-medium">
                {dirtyCount} uncommitted change{dirtyCount === 1 ? '' : 's'} will be lost
              </div>
              <label className="mt-1.5 flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={discard}
                  onChange={(e) => setDiscard(e.target.checked)}
                />
                Discard {dirtyCount} change{dirtyCount === 1 ? '' : 's'} permanently
              </label>
            </div>
          ) : (
            <div className="text-text-secondary text-[12.5px]">
              The worktree is clean — the folder is removed; commits stay on the branch.
            </div>
          )}

          {worktree.branch && !branchNote && (
            <label className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
              />
              Also delete branch <span className="font-mono">{worktree.branch}</span> (only if fully
              merged)
            </label>
          )}

          {error && <div className="text-danger text-[12px]">{error}</div>}
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-4 py-2.5">
          <button
            onClick={onClose}
            className="border-border hover:bg-bg-secondary rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            {branchNote ? 'Done' : 'Cancel'}
          </button>
          {!branchNote && (
            <button
              onClick={() => void remove()}
              disabled={busy || liveHere || (dirtyCount > 0 && !discard)}
              className="bg-danger hover:bg-danger/90 rounded-md px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Removing…' : 'Remove worktree'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
