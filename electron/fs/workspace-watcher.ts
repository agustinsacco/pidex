import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'

const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, Set<string>>()
const timers = new Map<string, NodeJS.Timeout>()

/**
 * Watch a workspace for file changes (explorer refresh + open-file reload +
 * git chip refresh). Broadcasts debounced `fs:changed` pushes with the list
 * of changed absolute paths.
 */
export function watchWorkspace(workspacePath: string): void {
  if (watchers.has(workspacePath)) return

  const watcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\.git([/\\]|$)/,
      /(^|[/\\])node_modules([/\\]|$)/,
      /(^|[/\\])\.venv([/\\]|$)/,
      /(^|[/\\])__pycache__([/\\]|$)/,
      /(^|[/\\])dist([/\\]|$)/,
      /(^|[/\\])out([/\\]|$)/,
    ],
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })

  const queue = (path: string): void => {
    const set = pending.get(workspacePath) ?? new Set()
    set.add(path)
    pending.set(workspacePath, set)
    const existing = timers.get(workspacePath)
    if (existing) clearTimeout(existing)
    timers.set(
      workspacePath,
      setTimeout(() => {
        const paths = [...(pending.get(workspacePath) ?? [])]
        pending.delete(workspacePath)
        timers.delete(workspacePath)
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('fs:changed', { workspacePath, paths })
          }
        }
      }, 250),
    )
  }

  watcher.on('add', queue)
  watcher.on('change', queue)
  watcher.on('unlink', queue)
  watcher.on('addDir', queue)
  watcher.on('unlinkDir', queue)
  watchers.set(workspacePath, watcher)
}

export async function unwatchAllWorkspaces(): Promise<void> {
  await Promise.allSettled([...watchers.values()].map((w) => w.close()))
  watchers.clear()
}
