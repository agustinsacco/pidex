import { useEffect, useState } from 'react'
import type { WorktreeInfo } from '@shared/models'
import { ModalOverlay } from '@/components/Modal'
import { useWorktreesStore } from '@/stores/worktrees'
import { RemoveWorktreeModal } from './RemoveWorktreeModal'

type Phase =
  | { step: 'commit'; dirtyCount: number }
  | { step: 'ready' }
  | { step: 'main-dirty'; dirtyCount: number }
  | { step: 'conflict'; conflicts: string[] }
  | { step: 'merged'; sha: string }

/**
 * Guided merge of a worktree branch into the main tree's CURRENT branch:
 * commit the worktree (user-typed message) → preflight (main must be clean —
 * pidex never checks out or stashes for the user) → `merge --no-ff`.
 * Conflicts abort immediately, so the repo is never left mid-merge.
 */
export function MergeWorktreeModal({
  repoPath,
  worktree,
  onClose,
}: {
  repoPath: string
  worktree: WorktreeInfo
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>(
    worktree.dirtyCount > 0
      ? { step: 'commit', dirtyCount: worktree.dirtyCount }
      : { step: 'ready' },
  )
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [freshWorktree, setFreshWorktree] = useState(worktree)

  const branch = worktree.branch

  // Refresh the worktree row after commit so the remove shortcut sees clean.
  useEffect(() => {
    if (phase.step !== 'merged') return
    void window.pidex.invoke('git:listWorktrees', repoPath).then((list) => {
      const updated = list.find((w) => w.path === worktree.path)
      if (updated) setFreshWorktree(updated)
    })
  }, [phase.step, repoPath, worktree.path])

  const commit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.pidex.invoke('git:commitAll', worktree.path, message)
      setPhase({ step: 'ready' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const merge = async (): Promise<void> => {
    if (!branch) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.pidex.invoke('git:mergeBranch', repoPath, branch)
      if (result.merged) {
        setPhase({ step: 'merged', sha: result.sha })
        void useWorktreesStore.getState().refresh(repoPath)
      } else if (result.reason === 'dirty') {
        setPhase({ step: 'main-dirty', dirtyCount: result.dirtyCount })
      } else {
        setPhase({ step: 'conflict', conflicts: result.conflicts })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (removing) {
    return <RemoveWorktreeModal repoPath={repoPath} worktree={freshWorktree} onClose={onClose} />
  }

  if (!branch) {
    return (
      <Shell onClose={onClose} title="Merge worktree">
        <div className="text-text-secondary px-4 py-3 text-[13px]">
          This worktree has a detached HEAD — check out a branch in it before merging.
        </div>
      </Shell>
    )
  }

  return (
    <Shell onClose={onClose} title={`Merge ${branch}`}>
      <div className="space-y-3 px-4 py-3 text-[13px]">
        {phase.step === 'commit' && (
          <>
            <div className="text-text-secondary text-[12.5px]">
              The worktree has {phase.dirtyCount} uncommitted change
              {phase.dirtyCount === 1 ? '' : 's'}. Commit them to{' '}
              <span className="font-mono">{branch}</span> first:
            </div>
            <input
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && message.trim()) void commit()
              }}
              placeholder="Commit message"
              className="border-border bg-surface text-text placeholder:text-text-tertiary w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-[var(--px-border-strong)]"
            />
          </>
        )}

        {phase.step === 'ready' && (
          <div className="text-text-secondary text-[12.5px]">
            Merge <span className="font-mono">{branch}</span> into the main tree&apos;s current
            branch with <span className="font-mono">--no-ff</span>. The main tree must be clean;
            pidex never checks out or stashes for you.
          </div>
        )}

        {phase.step === 'main-dirty' && (
          <div className="bg-warning/10 border-warning/30 rounded-lg border px-3 py-2.5 text-[12.5px]">
            The main tree has {phase.dirtyCount} uncommitted change
            {phase.dirtyCount === 1 ? '' : 's'}. Commit or stash them there, then retry.
          </div>
        )}

        {phase.step === 'conflict' && (
          <div className="bg-danger-soft border-danger/25 rounded-lg border px-3 py-2.5 text-[12.5px]">
            <div className="text-danger font-medium">
              Merge conflicts — aborted cleanly, nothing changed.
            </div>
            {phase.conflicts.length > 0 && (
              <ul className="text-text-secondary mt-1 max-h-32 list-inside list-disc overflow-y-auto font-mono text-[11.5px]">
                {phase.conflicts.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            )}
            <div className="text-text-secondary mt-1">
              Resolve in a terminal (merge manually) or rebase the branch first.
            </div>
          </div>
        )}

        {phase.step === 'merged' && (
          <div className="text-[12.5px]">
            <span className="text-success font-medium">Merged ✓</span>
            <span className="text-text-secondary font-mono"> {phase.sha.slice(0, 8)}</span>
            <div className="text-text-secondary mt-1">
              The worktree is no longer needed — remove it to tidy up.
            </div>
          </div>
        )}

        {error && <div className="text-danger text-[12px]">{error}</div>}
      </div>

      <div className="border-border flex justify-end gap-2 border-t px-4 py-2.5">
        <button
          onClick={onClose}
          className="border-border hover:bg-bg-secondary rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
        >
          {phase.step === 'merged' || phase.step === 'conflict' ? 'Done' : 'Cancel'}
        </button>
        {phase.step === 'commit' && (
          <button
            onClick={() => void commit()}
            disabled={busy || !message.trim()}
            className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Committing…' : 'Commit'}
          </button>
        )}
        {(phase.step === 'ready' || phase.step === 'main-dirty') && (
          <button
            onClick={() => void merge()}
            disabled={busy}
            className="bg-accent hover:bg-accent-hover text-accent-text rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Merging…' : phase.step === 'main-dirty' ? 'Retry merge' : 'Merge'}
          </button>
        )}
        {phase.step === 'merged' && (
          <button
            onClick={() => setRemoving(true)}
            className="border-border hover:bg-bg-secondary rounded-md border px-3.5 py-1.5 text-[12px] font-medium transition-colors"
          >
            Remove worktree…
          </button>
        )}
      </div>
    </Shell>
  )
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="border-border bg-surface-raised w-[460px] max-w-[92vw] overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-border border-b px-4 py-3">
          <div className="text-[13.5px] font-semibold">{title}</div>
        </div>
        {children}
      </div>
    </ModalOverlay>
  )
}
