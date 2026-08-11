import chokidar, { type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'

const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, Set<string>>()
const timers = new Map<string, NodeJS.Timeout>()

/**
 * Directory names never worth watching. Chokidar opens one file descriptor
 * PER DIRECTORY, so anything left out of this list costs real fds.
 *
 * Measured on a monorepo (augment-services, 2.7M entries): the original list
 * (.git, node_modules, .venv, __pycache__, dist, out) still left 47,060
 * directories to watch, which exhausted macOS's per-process kqueue limit and
 * threw EMFILE from inside chokidar — surfacing as the whole app freezing when
 * a session in that workspace was opened.
 */
const IGNORED_DIRS = [
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.gradle',
  '.terraform',
  '.tox',
  '.dart_tool',
  '.svelte-kit',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
]

/** Exported for tests: the pattern chokidar prunes the walk with. */
export const IGNORED_DIR_PATTERN = new RegExp(
  `(^|[/\\\\])(${IGNORED_DIRS.map((d) => d.replace(/\./g, '\\.')).join('|')})([/\\\\]|$)`,
)

/**
 * How deep to descend. Unbounded depth is what turns a big monorepo into tens
 * of thousands of watched directories.
 *
 * Measured on augment-services (depth ⇒ watched dirs / time to ready):
 *   unbounded ⇒ 47,060 dirs, never ready (EMFILE)
 *   6         ⇒  8,089 dirs, > 2min
 *   4         ⇒  3,354 dirs, 523ms
 *   3         ⇒  1,559 dirs, 168ms
 * Three keeps the app responsive on the worst repo here while still covering
 * a normal project end to end (pidex's own source tree bottoms out at depth 3).
 * Edits deeper than this stop producing `fs:changed` pushes; the git chips
 * still re-poll on window focus, so the cost is explorer immediacy, not
 * correctness.
 */
export const MAX_WATCH_DEPTH = 3

/**
 * Watch a workspace for file changes (explorer refresh + open-file reload +
 * git chip refresh). Broadcasts debounced `fs:changed` pushes with the list
 * of changed absolute paths.
 *
 * Bounded on purpose (see IGNORED_DIRS / MAX_WATCH_DEPTH): a deep or huge
 * repo must degrade to "watches less" rather than taking the main process
 * down with EMFILE.
 */
export function watchWorkspace(workspacePath: string): void {
  if (watchers.has(workspacePath)) return

  const watcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: IGNORED_DIR_PATTERN,
    depth: MAX_WATCH_DEPTH,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })

  // EMFILE and friends must never reach the main process as an uncaught
  // 'error' event — chokidar emits it asynchronously, so an unhandled one
  // takes the app down. Log and keep whatever the watcher did manage to bind.
  watcher.on('error', (error) => {
    console.warn(`[pidex] workspace watcher error for ${workspacePath}:`, error)
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

/** Close every workspace watcher and drop pending debounced change batches. */
export async function unwatchAllWorkspaces(): Promise<void> {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  pending.clear()
  await Promise.allSettled([...watchers.values()].map((w) => w.close()))
  watchers.clear()
}
