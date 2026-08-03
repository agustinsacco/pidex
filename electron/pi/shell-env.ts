import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * GUI-launched apps on macOS/Linux inherit a minimal PATH (`/usr/bin:/bin:…`),
 * not the one the user's shell builds. That breaks version managers — fnm,
 * nvm, asdf, volta — twice over:
 *
 *   1. `pi` itself isn't on the default PATH, so it can't be found.
 *   2. Even given an absolute path to `pi`, it starts with
 *      `#!/usr/bin/env node`, so *node* must also be on PATH or the process
 *      dies with "env: node: No such file or directory".
 *
 * So we resolve the login shell's PATH once and reuse it for every pi
 * subprocess, not just for discovery.
 */

let cachedPath: string | null = null
let inFlight: Promise<string | null> | null = null

/** The user's login-shell PATH, or null when it can't be determined. */
export async function getLoginShellPath(): Promise<string | null> {
  if (cachedPath !== null) return cachedPath
  if (inFlight) return inFlight

  inFlight = resolveLoginShellPath()
    .then((value) => {
      cachedPath = value ?? ''
      return value
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

async function resolveLoginShellPath(): Promise<string | null> {
  if (process.platform === 'win32') return process.env.PATH ?? null

  const shell = process.env.SHELL || '/bin/zsh'
  // A login+interactive shell so rc files that set up version managers run.
  // `-i` matters for fnm/nvm, which are typically wired up in .zshrc.
  for (const args of [
    ['-lic', 'printf %s "$PATH"'],
    ['-lc', 'printf %s "$PATH"'],
  ]) {
    try {
      const { stdout } = await execFileAsync(shell, args, { timeout: 15_000 })
      const value = stdout.trim().split('\n').pop()?.trim()
      if (value && value.includes('/')) return value
    } catch {
      // try the next form
    }
  }
  return null
}

/**
 * Environment for spawning pi: the caller's env with PATH upgraded to the
 * login shell's, so `#!/usr/bin/env node` resolves under a version manager.
 */
export async function piProcessEnv(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const shellPath = await getLoginShellPath()
  const base = { ...process.env } as Record<string, string>
  if (shellPath) {
    // Prefer the shell's PATH, keeping any inherited entries as a fallback.
    const inherited = process.env.PATH ?? ''
    const merged = inherited ? `${shellPath}:${inherited}` : shellPath
    base.PATH = dedupePath(merged)
  }
  return { ...base, ...extra }
}

function dedupePath(path: string): string {
  const seen = new Set<string>()
  return path
    .split(':')
    .filter((entry) => entry && !seen.has(entry) && (seen.add(entry), true))
    .join(':')
}

/** Test seam: forget the cached PATH. */
export function resetShellPathCache(): void {
  cachedPath = null
  inFlight = null
}
