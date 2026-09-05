import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Sandbox folders back the "No folder" option: a session that belongs to no
 * project still needs a real cwd for pi, so we mint one under the app's own
 * data dir (`<userData>/sandboxes/sandbox-N`). From then on it is an ordinary
 * workspace — it enters recents, hosts any number of sessions, and can be
 * removed from Settings → Workspaces like any other folder.
 *
 * The base is injected rather than read from `app` here so this module stays
 * importable in tests without mocking electron, and so E2E runs (which
 * redirect userData via PIDEX_TEST_USER_DATA) never write into the real one.
 */

/** The next free `sandbox-N` name, counting only names of exactly that shape. */
export function nextSandboxName(existing: string[]): string {
  let max = 0
  for (const name of existing) {
    const match = /^sandbox-(\d+)$/.exec(name)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `sandbox-${max + 1}`
}

/** Create `<base>/sandbox-N` (N = smallest unused) and return its path. */
export function createSandboxFolder(base: string): string {
  mkdirSync(base, { recursive: true })
  const path = join(base, nextSandboxName(readdirSync(base)))
  mkdirSync(path)
  return path
}
