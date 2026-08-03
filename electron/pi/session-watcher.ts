import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import { sessionDirForCwd } from './session-scanner'

const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, NodeJS.Timeout>()

/** Watch a workspace's session dir; broadcasts `sessions:changed` pushes. */
export function watchWorkspaceSessions(workspacePath: string): void {
  if (watchers.has(workspacePath)) return
  const dir = sessionDirForCwd(workspacePath)

  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  })

  const notify = (): void => {
    const existing = debounceTimers.get(workspacePath)
    if (existing) clearTimeout(existing)
    debounceTimers.set(
      workspacePath,
      setTimeout(() => {
        debounceTimers.delete(workspacePath)
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('sessions:changed', { workspacePath })
          }
        }
      }, 300),
    )
  }

  watcher.on('add', notify)
  watcher.on('change', notify)
  watcher.on('unlink', notify)
  watchers.set(workspacePath, watcher)
}

export async function unwatchAll(): Promise<void> {
  await Promise.allSettled([...watchers.values()].map((w) => w.close()))
  watchers.clear()
}
