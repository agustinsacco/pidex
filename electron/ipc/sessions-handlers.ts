import { handle } from './handle'
import { unwatchWorkspaceSessions, watchWorkspaceSessions } from '../pi/session-watcher'
import { listSessions, readSessionTree, usageSummary, workspaceStats } from '../pi/session-scanner'
import { deleteSession } from '../pi/session-deleter'
import { appendBranchJump, appendLabel, forkSessionAt } from '../pi/session-writer'
import { getPrefs } from '../store'

/** On-disk session discovery, tree reading and history rewrites. */
export function registerSessionsHandlers(): void {
  handle('sessions:list', (_event, workspacePath: string) => listSessions(workspacePath))

  // Home tiles describe work, so the project's orchestrator thread is not part
  // of them. Usage deliberately still lists it — labelled, not hidden.
  handle('sessions:stats', (_event, workspacePath: string) =>
    workspaceStats(workspacePath, Object.values(getPrefs().orchestratorSessions)),
  )

  handle('sessions:usage', () => usageSummary())

  handle('sessions:watch', (_event, workspacePath: string) => {
    watchWorkspaceSessions(workspacePath)
  })

  handle('sessions:unwatch', async (_event, workspacePath: string) => {
    await unwatchWorkspaceSessions(workspacePath)
  })

  handle('sessions:delete', async (_event, sessionFilePath: string) => {
    await deleteSession(sessionFilePath)
  })

  handle('sessions:readTree', (_event, sessionFilePath: string) => readSessionTree(sessionFilePath))

  handle('sessions:appendLabel', async (_event, sessionFilePath, targetId, label) => {
    await appendLabel(sessionFilePath, targetId, label)
  })

  handle('sessions:jump', async (_event, sessionFilePath, targetId) => {
    await appendBranchJump(sessionFilePath, targetId)
  })

  handle('sessions:forkAt', (_event, sessionFilePath, targetId) =>
    forkSessionAt(sessionFilePath, targetId),
  )
}
