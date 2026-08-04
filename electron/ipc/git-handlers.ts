import { handle } from './handle'
import { gitInfo } from '../fs/git-info'
import { createSessionBaseline, gitStatusMap, restoreFileTo, showFileAt } from '../fs/git-service'

/** Git status and per-file baseline/restore for the Changes pane. */
export function registerGitHandlers(): void {
  handle('git:info', (_event, workspacePath: string) => gitInfo(workspacePath))

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
}
