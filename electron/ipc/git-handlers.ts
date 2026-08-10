import { handle } from './handle'
import { gitInfo, gitInfoBatch } from '../fs/git-info'
import { ghAvailable, ghPrForBranch } from '../fs/gh-cli'
import { createSessionBaseline, gitStatusMap, restoreFileTo, showFileAt } from '../fs/git-service'
import {
  addWorktree,
  commitAll,
  listBranches,
  listWorktrees,
  mergeBranch,
  pruneWorktrees,
  removeWorktree,
} from '../fs/git-worktrees'

/** Git status and per-file baseline/restore for the Changes pane. */
export function registerGitHandlers(): void {
  handle('gh:available', () => ghAvailable())

  handle('gh:prForBranch', (_event, repoPath: string, branch: string) =>
    ghPrForBranch(repoPath, branch),
  )

  handle('git:info', (_event, workspacePath: string) => gitInfo(workspacePath))

  handle('git:infoBatch', (_event, cwds: string[]) => gitInfoBatch(cwds))

  handle('git:statusMap', (_event, workspacePath: string) => gitStatusMap(workspacePath))

  handle('git:sessionBaseline', (_event, workspacePath: string) =>
    createSessionBaseline(workspacePath),
  )

  handle('git:showFileAt', (_event, workspacePath, ref, relativePath) =>
    showFileAt(workspacePath, ref, relativePath),
  )

  handle('git:restoreFileTo', (_event, workspacePath, ref, relativePath) =>
    restoreFileTo(workspacePath, ref, relativePath),
  )

  handle('git:listWorktrees', (_event, repoPath) => listWorktrees(repoPath))

  handle('git:listBranches', (_event, repoPath) => listBranches(repoPath))

  handle('git:addWorktree', (_event, repoPath, name, branch) => addWorktree(repoPath, name, branch))

  handle('git:removeWorktree', (_event, repoPath, worktreePath, options) =>
    removeWorktree(repoPath, worktreePath, options),
  )

  handle('git:pruneWorktrees', (_event, repoPath) => pruneWorktrees(repoPath))

  handle('git:commitAll', (_event, worktreePath, message) => commitAll(worktreePath, message))

  handle('git:mergeBranch', (_event, repoPath, branch) => mergeBranch(repoPath, branch))
}
