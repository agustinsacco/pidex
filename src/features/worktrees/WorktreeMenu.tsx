import { useEffect, useState } from 'react'
import type { BranchInfo, WorktreeInfo } from '@shared/models'
import { MenuRow } from '@/components/PopupMenu'
import { CheckIcon } from '@/components/icons'
import { repoWorktrees, useWorktreesStore } from '@/stores/worktrees'
import { workspaceName } from '@/lib/path'

/**
 * The worktree picker body, shared by the home composer chip and the session
 * header chip.
 *
 * The two callers differ only in what "select" means — home records where the
 * *next* session will start, the session header opens that workspace — so the
 * action is injected and everything else (list, create, branch-as-worktree,
 * prune, remove) is identical. Before this existed the session header had no
 * worktree controls at all, which meant worktrees were reachable only from the
 * home screen and there was no way back to main from inside a worktree
 * session.
 *
 * Selecting an existing branch never checks it out in the main tree; it
 * creates (or reuses) a worktree for that branch instead.
 */
export function WorktreeMenu({
  repoPath,
  currentCwd,
  mainBranch,
  onSelectMain,
  onSelectWorktree,
  onRemove,
  onBusyError,
}: {
  repoPath: string
  /** Worktree path currently selected, or null when the main tree is. */
  currentCwd: string | null
  /** Branch shown on the "Main" row; defaults to the main worktree's branch. */
  mainBranch?: string
  onSelectMain: () => void
  onSelectWorktree: (worktree: WorktreeInfo) => void
  onRemove: (worktree: WorktreeInfo) => void
  onBusyError?: (message: string | null) => void
}): React.JSX.Element {
  const repo = useWorktreesStore((s) => repoWorktrees(s, repoPath))
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useWorktreesStore.getState().refresh(repoPath)
  }, [repoPath])

  const fail = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    setError(message)
    onBusyError?.(message)
  }

  const linked = repo.worktrees.filter((w) => !w.isMain)
  const mainLabel = mainBranch ?? repo.worktrees.find((w) => w.isMain)?.branch ?? repo.defaultBranch
  const prunable = repo.worktrees.some((w) => w.prunable)
  /**
   * Branches that can become a worktree. The default branch is excluded on
   * purpose: git only refuses a branch that is checked out *right now*, so
   * from a feature branch trunk looks free — and moving it into a worktree
   * permanently stops the main tree from checking it out. Trunk lives in the
   * main tree; the "Main" row above is how you get back to it.
   */
  const freeBranches = repo.branches.filter(
    (b) => !b.worktreePath && !b.isCurrent && b.name !== repo.defaultBranch,
  )

  const create = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    // Caught here rather than in git's own words: `worktree add -b` fails with
    // "a branch named 'x' already exists", which doesn't say what to do next.
    const clash = repo.branches.find((b) => b.name === name)
    if (clash) {
      setError(
        clash.worktreePath
          ? `Branch "${name}" already has a worktree. Pick it from the list above.`
          : `Branch "${name}" already exists. Open it from "Branches" above, or choose a new name.`,
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await useWorktreesStore
        .getState()
        .addWorktree(repoPath, name, { kind: 'new', base: base || 'HEAD' })
      setCreating(false)
      setNewName('')
      onSelectWorktree(created)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const worktreeFor = async (branch: BranchInfo): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const created = await useWorktreesStore
        .getState()
        .addWorktree(repoPath, branch.name.replace(/\//g, '-'), {
          kind: 'existing',
          branch: branch.name,
        })
      onSelectWorktree(created)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <MenuRow
        active={false}
        onClick={onSelectMain}
        title={`The main working tree — where ${repo.defaultBranch || 'the default branch'} lives`}
      >
        <span className="min-w-0 flex-1 truncate text-lg">
          Main tree — <span className="font-mono text-base">{mainLabel}</span>
        </span>
        {currentCwd === null && <CheckIcon className="text-accent shrink-0" />}
      </MenuRow>

      {linked.length > 0 && (
        <>
          <SectionHeading>Worktrees</SectionHeading>
          {linked.map((wt) => (
            <MenuRow key={wt.path} active={false} onClick={() => onSelectWorktree(wt)}>
              <span className="min-w-0 flex-1 truncate text-lg" title={wt.path}>
                {workspaceName(wt.path)}
                <span className="text-text-tertiary font-mono text-sm">
                  {' '}
                  {wt.branch ?? wt.head.slice(0, 8)}
                </span>
                {wt.dirtyCount > 0 && <span className="text-warning"> ±{wt.dirtyCount}</span>}
                {wt.prunable && <span className="text-danger"> missing</span>}
              </span>
              {currentCwd === wt.realPath && <CheckIcon className="text-accent shrink-0" />}
              {/* span, not button: MenuRow itself renders a <button>. */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(wt)
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
            <MenuRow key={branch.name} active={false} onClick={() => void worktreeFor(branch)}>
              <span
                className="min-w-0 flex-1 truncate font-mono text-base"
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
            placeholder="new branch name"
            className="border-border bg-surface text-text placeholder:text-text-tertiary w-full rounded-md border px-2 py-1 font-mono text-base outline-none focus:border-[var(--px-border-strong)]"
          />
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="border-border bg-surface text-text-secondary w-full rounded-md border px-2 py-1 text-base outline-none"
          >
            {/* Trunk first: branching off the default branch is the common
                case, and it reads better than the opaque "current HEAD". */}
            {repo.defaultBranch && (
              <option value={repo.defaultBranch}>base: {repo.defaultBranch} (default)</option>
            )}
            <option value="">base: current HEAD</option>
            {repo.branches
              .filter((b) => b.name !== repo.defaultBranch)
              .map((b) => (
                <option key={b.name} value={b.name}>
                  base: {b.name}
                </option>
              ))}
          </select>
          <button
            onClick={() => void create()}
            disabled={busy || !newName.trim()}
            className="bg-accent hover:bg-accent-hover text-accent-text w-full rounded-md px-2 py-1 text-base font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create worktree'}
          </button>
        </div>
      ) : (
        <MenuRow active={false} onClick={() => setCreating(true)}>
          <span className="text-lg">New worktree…</span>
        </MenuRow>
      )}

      {prunable && (
        <MenuRow active={false} onClick={() => void useWorktreesStore.getState().prune(repoPath)}>
          <span className="text-text-secondary text-lg">Prune stale worktrees</span>
        </MenuRow>
      )}

      {error && <div className="text-danger px-3 py-1 text-sm">{error}</div>}
    </>
  )
}

function SectionHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="text-text-tertiary px-3 pb-0.5 pt-1.5 font-mono text-xs uppercase tracking-wide">
      {children}
    </div>
  )
}
