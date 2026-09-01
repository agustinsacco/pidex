import chokidar, { type FSWatcher } from 'chokidar'
import { opendirSync, type Dir, type Stats } from 'node:fs'
import { normalize, relative } from 'node:path'
import { BrowserWindow } from 'electron'

const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, Set<string>>()
const timers = new Map<string, NodeJS.Timeout>()

/**
 * Directory names never worth watching.
 *
 * Cheap static prune, applied before anything that touches the disk. It is a
 * hint, not a bound: the real ceilings are MAX_DIR_ENTRIES and
 * MAX_WATCHED_PATHS below.
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
 *
 * This caps the WALK, not the fd count — see MAX_WATCHED_PATHS.
 */
export const MAX_WATCH_DEPTH = 3

/**
 * Entries a single directory may hold before the walk skips it whole.
 *
 * A flat dump directory is the cheapest way to exhaust the process, because
 * it costs one fd per FILE and the depth cap does nothing about it — every
 * file sits at the same legal depth. Measured on augment-local:
 * `.overrides-local/workflow-retries/captures` held 133,518 JSON files at
 * exactly depth 3, and the walk opened 91,255 of them before macOS refused
 * at `kern.maxfilesperproc`.
 *
 * A source directory with more than two thousand files in it (not in its
 * subtree) is generated data, not code, so skipping it whole is the right
 * trade: it costs zero fds instead of eating the budget the real source
 * tree needs.
 */
export const MAX_DIR_ENTRIES = 2_000

/**
 * Hard ceiling on paths one workspace watcher may hold open.
 *
 * The last line of defence, and the only one that is a true bound: the prune
 * list and the depth cap are both heuristics that a sufficiently odd repo
 * walks straight past. Reaching this cap degrades the explorer to "watches
 * less"; overrunning it takes the whole main process down, because every
 * later `open()` fails — including electron-store reading `config.json`,
 * which is how this surfaced ("EMFILE ... open '.../pidex/config.json'" when
 * starting a session).
 */
export const MAX_WATCHED_PATHS = 12_000

/** Match chokidar's own path normalization before comparing or recording. */
function unixPath(path: string): string {
  return normalize(path).replace(/\\/g, '/')
}

/**
 * Cached per directory, because chokidar re-asks on every rescan and the
 * answer only matters as a bound. A directory that grows past the cap after
 * being probed is caught by MAX_WATCHED_PATHS instead.
 */
const oversizedDirs = new Map<string, boolean>()

/**
 * True when `dir` holds more than MAX_DIR_ENTRIES entries.
 *
 * Stops reading the moment it knows, so probing a directory of a million
 * files costs the same as probing one of two thousand. `Dir.readSync` reads
 * through a buffer, so this is a handful of syscalls, not one per entry.
 */
function dirExceedsEntryCap(dir: string): boolean {
  const cached = oversizedDirs.get(dir)
  if (cached !== undefined) return cached

  let oversized = false
  let handle: Dir | undefined
  try {
    handle = opendirSync(dir, { bufferSize: 256 })
    let seen = 0
    while (handle.readSync() !== null) {
      if (++seen > MAX_DIR_ENTRIES) {
        oversized = true
        break
      }
    }
  } catch {
    // Unreadable or already gone: let the ordinary walk deal with it.
  } finally {
    try {
      handle?.closeSync()
    } catch {
      // Reading to the end closes the handle itself; closing twice throws.
    }
  }

  if (oversized) {
    console.warn(
      `[pidex] not watching ${dir}: more than ${MAX_DIR_ENTRIES} entries in one directory`,
    )
  }
  oversizedDirs.set(dir, oversized)
  return oversized
}

/** The `ignored` predicate for one watcher, plus the accounting behind it. */
export interface WatchFilter {
  /** chokidar's `ignored` option: true means "do not watch this path". */
  ignored: (path: string, stats?: Stats) => boolean
  /** chokidar dropped this path (unlink); hand its slot back to the budget. */
  release: (path: string) => void
  /** Paths currently counted against MAX_WATCHED_PATHS. */
  readonly size: number
}

/**
 * Build the bounded `ignored` predicate for one workspace.
 *
 * Three bounds, cheapest first: the static prune list, the per-directory
 * entry cap, then the hard budget.
 *
 * Only calls that carry `stats` may spend budget. chokidar asks twice per
 * path — once from readdirp with stats, once without — and recording on the
 * stats-free call would both double-count and skip the directory probe.
 * A path already granted a slot always answers "not ignored", so repeated
 * questions are idempotent.
 *
 * `isOversized` is injected so tests can exercise the cap without laying
 * down thousands of real files.
 */
export function createWatchFilter(
  root: string,
  isOversized: (dir: string) => boolean = dirExceedsEntryCap,
): WatchFilter {
  const rootPath = unixPath(root)
  const granted = new Set<string>()
  let warned = false

  const ignored = (rawPath: string, stats?: Stats): boolean => {
    const path = unixPath(rawPath)
    // Never prune the watch root: ignoring it watches nothing at all.
    if (path === rootPath) return false
    // Matched against the path RELATIVE to the workspace, never the absolute
    // one. A repo living under a directory that happens to be named `build`,
    // `out`, `tmp` or `vendor` — /Users/me/build/myapp, or anything under
    // macOS's /private/tmp — would otherwise have every file it owns pruned,
    // silently leaving the explorer with no watcher at all.
    if (IGNORED_DIR_PATTERN.test(unixPath(relative(rootPath, path)))) return true
    if (granted.has(path)) return false
    if (!stats) return granted.size >= MAX_WATCHED_PATHS
    if (stats.isDirectory() && isOversized(path)) return true
    if (granted.size >= MAX_WATCHED_PATHS) {
      if (!warned) {
        warned = true
        console.warn(
          `[pidex] watch budget reached for ${root} (${MAX_WATCHED_PATHS} paths); ` +
            'file changes past this point will not refresh the explorer',
        )
      }
      return true
    }
    granted.add(path)
    return false
  }

  return {
    ignored,
    release: (rawPath: string) => {
      granted.delete(unixPath(rawPath))
    },
    get size() {
      return granted.size
    },
  }
}

/**
 * Watch a workspace for file changes (explorer refresh + open-file reload +
 * git chip refresh). Broadcasts debounced `fs:changed` pushes with the list
 * of changed absolute paths.
 *
 * Bounded on purpose (see `createWatchFilter`): a deep, huge, or
 * dump-directory-carrying repo must degrade to "watches less" rather than
 * taking the main process down with EMFILE.
 */
export function watchWorkspace(workspacePath: string): void {
  if (watchers.has(workspacePath)) return

  const filter = createWatchFilter(workspacePath)
  const watcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: filter.ignored,
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

  // A deleted path stops costing an fd, so its budget slot goes back. Without
  // this the budget only ever shrinks, and a long session in a churning repo
  // would quietly stop watching anything new.
  const dropped = (path: string): void => {
    filter.release(path)
    queue(path)
  }

  watcher.on('add', queue)
  watcher.on('change', queue)
  watcher.on('unlink', dropped)
  watcher.on('addDir', queue)
  watcher.on('unlinkDir', dropped)
  watchers.set(workspacePath, watcher)
}

/** Close every workspace watcher and drop pending debounced change batches. */
export async function unwatchAllWorkspaces(): Promise<void> {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  pending.clear()
  oversizedDirs.clear()
  await Promise.allSettled([...watchers.values()].map((w) => w.close()))
  watchers.clear()
}
