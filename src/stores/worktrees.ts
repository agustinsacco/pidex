import { create } from 'zustand'
import type { AddWorktreeBranch, BranchInfo, WorktreeInfo } from '@shared/models'

interface RepoWorktrees {
  worktrees: WorktreeInfo[]
  branches: BranchInfo[]
  defaultBranch: string
  loadedAt: number
}

/** Stable empty value so selectors don't allocate a new object per render. */
const EMPTY_REPO: RepoWorktrees = Object.freeze({
  worktrees: [],
  branches: [],
  defaultBranch: '',
  loadedAt: 0,
})

interface WorktreesState {
  byRepo: Record<string, RepoWorktrees>
  refresh: (repoPath: string) => Promise<void>
  addWorktree: (repoPath: string, name: string, branch: AddWorktreeBranch) => Promise<WorktreeInfo>
  removeWorktree: (
    repoPath: string,
    worktreePath: string,
    options: { force?: boolean; deleteBranch?: boolean },
  ) => Promise<
    | { removed: true; branchDeleted: boolean; branchError?: string }
    | { removed: false; dirtyCount: number }
  >
  prune: (repoPath: string) => Promise<string[]>
}

/** Worktree/branch state for a repo; shared frozen empty value. */
export function repoWorktrees(state: WorktreesState, repoPath: string): RepoWorktrees {
  return state.byRepo[repoPath] ?? EMPTY_REPO
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  byRepo: {},

  refresh: async (repoPath) => {
    try {
      const [worktrees, branchData] = await Promise.all([
        window.pidex.invoke('git:listWorktrees', repoPath),
        window.pidex.invoke('git:listBranches', repoPath),
      ])
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [repoPath]: {
            worktrees,
            branches: branchData.branches,
            defaultBranch: branchData.defaultBranch,
            loadedAt: Date.now(),
          },
        },
      }))
    } catch {
      set((s) => ({ byRepo: { ...s.byRepo, [repoPath]: { ...EMPTY_REPO, loadedAt: Date.now() } } }))
    }
  },

  addWorktree: async (repoPath, name, branch) => {
    const created = await window.pidex.invoke('git:addWorktree', repoPath, name, branch)
    await get().refresh(repoPath)
    return created
  },

  removeWorktree: async (repoPath, worktreePath, options) => {
    const result = await window.pidex.invoke('git:removeWorktree', repoPath, worktreePath, options)
    if (result.removed) await get().refresh(repoPath)
    return result
  },

  prune: async (repoPath) => {
    const { pruned } = await window.pidex.invoke('git:pruneWorktrees', repoPath)
    await get().refresh(repoPath)
    return pruned
  },
}))
