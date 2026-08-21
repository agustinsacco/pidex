import { create } from 'zustand'
import type {
  AddWorktreeBranch,
  BranchInfo,
  CheckoutResult,
  PullResult,
  UpdateFromMainResult,
  WorktreeInfo,
} from '@shared/models'

interface RepoWorktrees {
  worktrees: WorktreeInfo[]
  branches: BranchInfo[]
  defaultBranch: string
  loadedAt: number
  /** True while a `git fetch` is in flight, so the chip can show a spinner. */
  fetching: boolean
  /** When the remote was last successfully fetched; 0 when never this session. */
  fetchedAt: number
}

/** Stable empty value so selectors don't allocate a new object per render. */
const EMPTY_REPO: RepoWorktrees = Object.freeze({
  worktrees: [],
  branches: [],
  defaultBranch: '',
  loadedAt: 0,
  fetching: false,
  fetchedAt: 0,
})

interface WorktreesState {
  byRepo: Record<string, RepoWorktrees>
  /**
   * Whether picking a branch should give it its own worktree (checked) or
   * check it out in place (unchecked). Global rather than per-repo: it tracks
   * how the user likes to work, not a property of any one checkout. Defaults
   * on, because isolation is the safe answer and the whole reason worktrees
   * are wired into sessions at all.
   */
  preferWorktree: boolean
  setPreferWorktree: (value: boolean) => void
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
  /**
   * Fetch the remote, then reload branches so the new `behind` counts land.
   * Main throttles per repo, so calling this on every menu open is cheap.
   */
  syncRemote: (repoPath: string, options?: { force?: boolean }) => Promise<void>
  pull: (repoPath: string, cwd: string) => Promise<PullResult>
  updateFromMain: (repoPath: string, worktreePath: string) => Promise<UpdateFromMainResult>
  checkout: (repoPath: string, branch: string) => Promise<CheckoutResult>
}

/** Worktree/branch state for a repo; shared frozen empty value. */
export function repoWorktrees(state: WorktreesState, repoPath: string): RepoWorktrees {
  return state.byRepo[repoPath] ?? EMPTY_REPO
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  byRepo: {},

  preferWorktree: true,
  setPreferWorktree: (value) => set({ preferWorktree: value }),

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
            // Spread the previous entry so a refresh triggered mid-fetch does
            // not blank out `fetching`/`fetchedAt` and strand the spinner.
            ...(s.byRepo[repoPath] ?? EMPTY_REPO),
            worktrees,
            branches: branchData.branches,
            defaultBranch: branchData.defaultBranch,
            loadedAt: Date.now(),
          },
        },
      }))
    } catch {
      // Listing failed (not a repo, git missing): clear the lists as before,
      // but keep the fetch bookkeeping so an in-flight spinner still resolves.
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [repoPath]: {
            ...EMPTY_REPO,
            fetching: s.byRepo[repoPath]?.fetching ?? false,
            fetchedAt: s.byRepo[repoPath]?.fetchedAt ?? 0,
            loadedAt: Date.now(),
          },
        },
      }))
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

  syncRemote: async (repoPath, options = {}) => {
    const patch = (fields: Partial<RepoWorktrees>): void =>
      set((s) => ({
        byRepo: { ...s.byRepo, [repoPath]: { ...(s.byRepo[repoPath] ?? EMPTY_REPO), ...fields } },
      }))

    patch({ fetching: true })
    try {
      const result = await window.pidex.invoke('git:fetch', repoPath, options)
      if (result.fetched) {
        patch({ fetchedAt: result.at })
        // Only re-list when something could actually have moved. A throttled
        // or failed fetch leaves every ref where it was.
        await get().refresh(repoPath)
      } else if (result.reason === 'throttled') {
        patch({ fetchedAt: result.at })
      }
    } finally {
      patch({ fetching: false })
    }
  },

  pull: async (repoPath, cwd) => {
    const result = await window.pidex.invoke('git:pull', cwd)
    if (result.pulled) await get().refresh(repoPath)
    return result
  },

  updateFromMain: async (repoPath, worktreePath) => {
    const mainBranch = repoWorktrees(get(), repoPath).defaultBranch
    const result = await window.pidex.invoke('git:updateFromMain', worktreePath, mainBranch)
    if (result.updated) await get().refresh(repoPath)
    return result
  },

  checkout: async (repoPath, branch) => {
    const result = await window.pidex.invoke('git:checkoutBranch', repoPath, branch)
    if (result.checkedOut) await get().refresh(repoPath)
    return result
  },
}))
