import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { GitInfo, WorktreeInfo } from '@shared/models'
import { PopupMenu, MenuRow } from '@/components/PopupMenu'
import { BranchIcon, CheckIcon, ChevronIcon } from '@/components/icons'
import { repoWorktrees, useWorktreesStore } from '@/stores/worktrees'
import { RemoveWorktreeModal } from './RemoveWorktreeModal'
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
  const repo = useWorktreesStore((s) => repoWorktrees(s, repoPath))
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [base, setBase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WorktreeInfo | null>(null)

  useEffect(() => {
    if (open) void useWorktreesStore.getState().refresh(repoPath)
  }, [open, repoPath])

  const dirty = git.dirtyCount ?? 0
  const linked = repo.worktrees.filter((w) => !w.isMain)
  const prunable = repo.worktrees.some((w) => w.prunable)
  const freeBranches = repo.branches.filter((b) => !b.worktreePath && !b.isCurrent)

  const create = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await useWorktreesStore
        .getState()
        .addWorktree(repoPath, name, { kind: 'new', base: base || 'HEAD' })
      onSelect({ cwd: created.realPath, label: name })
      setCreating(false)
      setNewName('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const worktreeFor = async (branch: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const created = await useWorktreesStore
        .getState()
        .addWorktree(repoPath, branch.replace(/\//g, '-'), { kind: 'existing', branch })
      onSelect({ cwd: created.realPath, label: branch })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="relative">
      <button
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
          className="absolute bottom-full left-0 z-40 mb-1.5 max-h-96 w-80 overflow-y-auto py-1.5"
        >
          <div className="px-3 pb-1.5 pt-1">
            <div className="text-text-tertiary text-[11px]">Next session starts in</div>
          </div>

          <MenuRow
            active={false}
            onClick={() => {
              onSelect(null)
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">
              Main — <span className="font-mono text-[12px]">{git.branch}</span>
            </span>
            {target === null && <CheckIcon className="text-accent shrink-0" />}
          </MenuRow>

          {linked.length > 0 && (
            <>
              <SectionHeading>Worktrees</SectionHeading>
              {linked.map((wt) => (
                <MenuRow
                  key={wt.path}
                  active={false}
                  onClick={() => {
                    onSelect({ cwd: wt.realPath, label: workspaceName(wt.path) })
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]" title={wt.path}>
                    {workspaceName(wt.path)}
                    <span className="text-text-tertiary font-mono text-[11.5px]">
                      {' '}
                      {wt.branch ?? wt.head.slice(0, 8)}
                    </span>
                    {wt.dirtyCount > 0 && <span className="text-warning"> ±{wt.dirtyCount}</span>}
                    {wt.prunable && <span className="text-danger"> missing</span>}
                  </span>
                  {target?.cwd === wt.realPath && <CheckIcon className="text-accent shrink-0" />}
                  {/* span, not button: MenuRow itself renders a <button>. */}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(false)
                      setRemoveTarget(wt)
                    }}
                    title="Remove worktree…"
                    className="text-text-tertiary hover:text-danger shrink-0 px-1"
                  >
                    ✕
                  </span>
                </MenuRow>
              ))}
            </>
          )}

          {freeBranches.length > 0 && (
            <>
              <SectionHeading>Branches (opens as worktree)</SectionHeading>
              {freeBranches.slice(0, 8).map((branch) => (
                <MenuRow
                  key={branch.name}
                  active={false}
                  onClick={() => void worktreeFor(branch.name)}
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[12px]"
                    title={branch.lastCommitSubject}
                  >
                    {branch.name}
                  </span>
                </MenuRow>
              ))}
            </>
          )}

          <div className="border-border my-1 border-t" />

          {creating ? (
            <div className="space-y-1.5 px-3 py-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
                placeholder="worktree / branch name"
                className="border-border bg-surface text-text placeholder:text-text-tertiary w-full rounded-md border px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--px-border-strong)]"
              />
              <select
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="border-border bg-surface text-text-secondary w-full rounded-md border px-2 py-1 text-[12px] outline-none"
              >
                <option value="">base: current HEAD</option>
                {repo.branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    base: {b.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void create()}
                disabled={busy || !newName.trim()}
                className="bg-accent hover:bg-accent-hover text-accent-text w-full rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create worktree'}
              </button>
            </div>
          ) : (
            <MenuRow active={false} onClick={() => setCreating(true)}>
              <span className="text-[13px]">New worktree…</span>
            </MenuRow>
          )}

          {prunable && (
            <MenuRow
              active={false}
              onClick={() => {
                setOpen(false)
                void useWorktreesStore.getState().prune(repoPath)
              }}
            >
              <span className="text-text-secondary text-[13px]">Prune stale worktrees</span>
            </MenuRow>
          )}

          {error && <div className="text-danger px-3 py-1 text-[11.5px]">{error}</div>}
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

function SectionHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="text-text-tertiary px-3 pb-0.5 pt-1.5 font-mono text-[10px] uppercase tracking-wide">
      {children}
    </div>
  )
}
