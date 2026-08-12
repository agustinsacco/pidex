/**
 * The updater's state machine, as a pure reducer.
 *
 * Kept free of `electron-updater` and Electron so every transition is unit
 * testable without a packaged app or a network. `updater.ts` owns the I/O and
 * feeds events in here.
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  /** Verified and staged; a restart installs it. */
  | 'downloaded'
  /**
   * An update exists but this install cannot apply it itself (unsigned macOS,
   * or a deb where the package manager owns the files). The UI offers a
   * download link instead of pretending a restart would work.
   */
  | 'manual-download'
  /** No update mechanism at all (dev, or an unpackaged run). */
  | 'unsupported'

export interface UpdateState {
  phase: UpdatePhase
  /** Version being offered; absent unless one is. */
  version?: string
  /** 0-100 while downloading. */
  progressPercent?: number
  /** Where to send the user when they must install by hand. */
  releaseUrl?: string
}

export type UpdateEvent =
  | { type: 'check-started' }
  | { type: 'update-available'; version: string }
  | { type: 'update-not-available' }
  | { type: 'download-progress'; percent: number }
  | { type: 'update-downloaded'; version: string }
  /** The install can detect but not self-apply. */
  | { type: 'manual-required'; version: string; releaseUrl: string }
  | { type: 'error' }

export const IDLE: UpdateState = { phase: 'idle' }

/**
 * Fold one updater event into the current state.
 *
 * Errors deliberately collapse to `idle` rather than surfacing: a failed update
 * check is not the user's problem to solve and must never nag. `updater.ts`
 * logs the underlying error.
 */
export function reduceUpdate(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'check-started':
      // Never interrupt a download or discard a staged update to say "checking".
      if (state.phase === 'downloading' || state.phase === 'downloaded') return state
      return { phase: 'checking' }

    case 'update-available':
      return { phase: 'downloading', version: event.version, progressPercent: 0 }

    case 'update-not-available':
      // A staged update stays staged: a later check finding nothing newer does
      // not mean the one already on disk went away.
      if (state.phase === 'downloaded' || state.phase === 'manual-download') return state
      return IDLE

    case 'download-progress':
      if (state.phase !== 'downloading') return state
      return { ...state, progressPercent: clampPercent(event.percent) }

    case 'update-downloaded':
      return { phase: 'downloaded', version: event.version }

    case 'manual-required':
      return { phase: 'manual-download', version: event.version, releaseUrl: event.releaseUrl }

    case 'error':
      // Keep anything already usable; otherwise fall back to silence.
      if (state.phase === 'downloaded' || state.phase === 'manual-download') return state
      return IDLE

    default:
      return state
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * Compare two `x.y.z` versions. Returns true when `candidate` is newer.
 *
 * Used by the manual-download poller, which reads `latest-*.yml` directly and
 * therefore cannot lean on electron-updater's own comparison. Numeric per
 * segment on purpose: string comparison puts 0.1.9 above 0.1.10, which would
 * strand every user on the ninth release.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/, '')
      // Drop any prerelease/build suffix; pidex ships plain x.y.z.
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10))

  const a = parse(candidate)
  const b = parse(current)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}
