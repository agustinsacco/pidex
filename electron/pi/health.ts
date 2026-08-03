import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MIN_PI_VERSION, type PiHealth } from '@shared/models'

const execFileAsync = promisify(execFile)

/** Compare dotted semver-ish strings. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Locate the pi binary on PATH and gate on MIN_PI_VERSION.
 *
 * GUI apps on macOS/Linux don't inherit the user's shell PATH, so we ask the
 * login shell where pi lives instead of relying on process.env.PATH alone.
 */
export async function checkPiHealth(): Promise<PiHealth> {
  const binaryPath = await findPiBinary()
  if (!binaryPath) {
    return {
      ok: false,
      minVersion: MIN_PI_VERSION,
      reason: 'not-found',
      message:
        'The pi coding agent was not found on your PATH. Install it with: npm install -g @earendil-works/pi-coding-agent',
    }
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 15_000 })
    const version = stdout.trim().split('\n')[0]?.trim() ?? ''
    if (!/^\d+\.\d+/.test(version)) {
      return {
        ok: false,
        binaryPath,
        minVersion: MIN_PI_VERSION,
        reason: 'version-check-failed',
        message: `Unexpected output from pi --version: "${version}"`,
      }
    }
    if (compareVersions(version, MIN_PI_VERSION) < 0) {
      return {
        ok: false,
        binaryPath,
        version,
        minVersion: MIN_PI_VERSION,
        reason: 'too-old',
        message: `pi ${version} is older than the minimum supported ${MIN_PI_VERSION}. Update with: npm install -g @earendil-works/pi-coding-agent@latest`,
      }
    }
    return { ok: true, binaryPath, version, minVersion: MIN_PI_VERSION }
  } catch (error) {
    return {
      ok: false,
      binaryPath,
      minVersion: MIN_PI_VERSION,
      reason: 'version-check-failed',
      message: `Failed to run pi --version: ${(error as Error).message}`,
    }
  }
}

async function findPiBinary(): Promise<string | null> {
  const probe = process.platform === 'win32' ? probeWindows : probePosix
  return probe()
}

async function probePosix(): Promise<string | null> {
  // 1. Current process PATH (works in dev, where Electron inherits the shell).
  try {
    const { stdout } = await execFileAsync('/bin/sh', ['-lc', 'command -v pi'], {
      timeout: 15_000,
    })
    const found = stdout.trim()
    if (found) return found
  } catch {
    // fall through
  }
  // 2. Login shell PATH (packaged GUI launches).
  const shell = process.env.SHELL || '/bin/bash'
  try {
    const { stdout } = await execFileAsync(shell, ['-lic', 'command -v pi'], {
      timeout: 15_000,
    })
    const found = stdout.trim().split('\n').pop()?.trim()
    if (found) return found
  } catch {
    // fall through
  }
  return null
}

async function probeWindows(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where', ['pi'], { timeout: 15_000 })
    const found = stdout.trim().split(/\r?\n/)[0]?.trim()
    return found || null
  } catch {
    return null
  }
}
