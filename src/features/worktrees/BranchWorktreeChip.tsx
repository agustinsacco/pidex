import { useRef, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, WorktreeInfo } from '@shared/models'
import { PopupMenu } from '@/components/PopupMenu'
import { BranchIcon, ChevronIcon } from '@/components/icons'
import { RemoveWorktreeModal } from './RemoveWorktreeModal'
import { WorktreeMenu } from './WorktreeMenu'
import { PrRow } from './PrRow'
import { workspaceName } from '@/lib/path'

/** Where the next session starts: the main tree or a linked worktree. */
export interface StartTarget {
  cwd: string
  label: string
}

/**
 * The home composer's branch chip, upgraded from read-only status to the
 * worktree control: pick where the next session runs (main vs a worktree),
 * create a worktree (+ branch), remove or prune ones you're done with.
 *
 * The one thing it will never do is check out a branch in the main tree —
 * selecting an existing branch offers a worktree for it instead.
 */
export function BranchWorktreeChip({
  workspacePath,
  git,
  target,
  onSelect,
}: {
  workspacePath: string
  git: GitInfo
  target: StartTarget | null
  onSelect: (target: StartTarget | null) => void
}): React.JSX.Element {
  const repoPath = git.isWorktree && git.mainRepoPath ? git.mainRepoPath : workspacePath
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null)

  const dirty = git.dirtyCount ?? 0

  return (
    <span className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title={target ? `Session starts in worktree ${target.label}` : `Branch ${git.branch ?? ''}`}
        data-testid="branch-chip"
        aria-expanded={open}
        className={clsx(
          'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
          open
            ? 'bg-bg-secondary text-text border-border-strong'
            : 'bg-surface text-text-secondary hover:text-text hover:border-border-strong',
        )}
      >
        <BranchIcon />
        {target ? (
          <>
            <span className="bg-accent-soft text-accent rounded px-1 text-[10px]">wt</span>
            {target.label}
          </>
        ) : (
          <>
            {git.branch}
            {dirty > 0 ? <span className="text-warning ml-1">·{dirty}</span> : null}
          </>
        )}
        <ChevronIcon size={10} className="text-text-tertiary" />
      </button>

      {open && (
        <PopupMenu
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          className="absolute bottom-full left-0 z-40 mb-1.5 max-h-96 w-80 overflow-y-auto py-1.5"
        >
          <div className="px-3 pb-1.5 pt-1">
            <div className="text-text-tertiary text-[11px]">Next session starts in</div>
          </div>

          <WorktreeMenu
            repoPath={repoPath}
            currentCwd={target?.cwd ?? null}
            mainBranch={git.branch ?? ''}
            onSelectMain={() => {
              onSelect(null)
              setOpen(false)
            }}
            onSelectWorktree={(wt) => {
              onSelect({ cwd: wt.realPath, label: workspaceName(wt.path) })
              setOpen(false)
            }}
            onRemove={(wt) => {
              setOpen(false)
              setRemoveTarget(wt)
            }}
          />

          {git.branch && <PrRow repoPath={repoPath} branch={git.branch} />}
        </PopupMenu>
      )}

      {removeTarget && (
        <RemoveWorktreeModal
          repoPath={repoPath}
          worktree={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            if (target?.cwd === removeTarget.realPath) onSelect(null)
          }}
        />
      )}
    </span>
  )
}
