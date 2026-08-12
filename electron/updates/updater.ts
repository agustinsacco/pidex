import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import {
  IDLE,
  isNewerVersion,
  reduceUpdate,
  type UpdateEvent,
  type UpdateState,
} from './update-state'

/**
 * Update checks against the GitHub releases the continuous-release workflow
 * publishes.
 *
 * Hard-gated on `app.isPackaged`: dev runs, the browser harness and the
 * Playwright suite must never reach the network for this. `electron-updater`
 * is imported lazily for the same reason — an unpackaged run should not even
 * load it.
 *
 * Two paths, chosen at startup rather than by waiting for a failure:
 *
 *  - **Full auto-update** where the platform can actually install
 *    (signed macOS, Linux AppImage) — download, then a restart applies it.
 *  - **Manual download** where it cannot (unsigned macOS, because Squirrel.Mac
 *    validates the code signature and refuses; deb, because the package
 *    manager owns those files). Detection still works; the UI offers a link
 *    instead of promising a restart that would silently do nothing.
 */

const REPO = 'agustinsacco/pidex'
const RELEASES_LATEST = `https://github.com/${REPO}/releases/latest`
const CHECK_INTERVAL_MS = 30 * 60 * 1000

let state: UpdateState = IDLE
let timer: NodeJS.Timeout | null = null
let started = false

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('updates:event', state)
  }
}

function apply(event: UpdateEvent): void {
  const next = reduceUpdate(state, event)
  if (next === state) return
  state = next
  broadcast()
}

export function currentUpdateState(): UpdateState {
  return state
}

/**
 * Whether this build can install its own updates.
 *
 * CI stamps `pidexSigned` into the packaged package.json only when the signing
 * secrets were present (and always for Linux, where AppImage self-updates
 * without signing). Reading a build-time flag beats probing at runtime: the
 * answer is known before the first check, so the UI never promises a restart
 * it cannot deliver.
 */
function canSelfInstall(): boolean {
  // deb/rpm installs are owned by the package manager; electron-updater cannot
  // replace those files, and APPIMAGE is set only when running as an AppImage.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return false

  return readPackagedFlag() ?? false
}

function readPackagedFlag(): boolean | null {
  try {
    // `getAppPath()` is the asar root in a packaged app, which is where
    // electron-builder writes the package.json its extraMetadata patched.
    const raw = readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { pidexSigned?: boolean | string }
    // CLI-injected metadata arrives as the STRING "true", not a boolean.
    return pkg.pidexSigned === true || pkg.pidexSigned === 'true'
  } catch {
    return null
  }
}

/** Poll the release manifest directly, for installs that cannot self-update. */
async function checkManually(): Promise<void> {
  apply({ type: 'check-started' })
  try {
    // A static asset on the release, not the API: no auth, no rate limit.
    const manifest = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest-linux.yml'
    const response = await fetch(
      `https://github.com/${REPO}/releases/latest/download/${manifest}`,
      { redirect: 'follow' },
    )
    if (!response.ok) {
      apply({ type: 'error' })
      return
    }
    const body = await response.text()
    // The manifest is small YAML; the only field needed is `version:`.
    const version = /^version:\s*(.+)$/m.exec(body)?.[1]?.trim()
    if (!version) {
      apply({ type: 'error' })
      return
    }
    if (isNewerVersion(version, app.getVersion())) {
      apply({ type: 'manual-required', version, releaseUrl: RELEASES_LATEST })
    } else {
      apply({ type: 'update-not-available' })
    }
  } catch {
    // Offline, DNS failure, GitHub down — all the same to the user: nothing.
    apply({ type: 'error' })
  }
}

async function checkWithUpdater(): Promise<void> {
  apply({ type: 'check-started' })
  try {
    const { autoUpdater } = await import('electron-updater')
    await autoUpdater.checkForUpdates()
  } catch (error) {
    console.warn('[pidex] update check failed:', error)
    apply({ type: 'error' })
  }
}

async function wireUpdaterEvents(): Promise<void> {
  const { autoUpdater } = await import('electron-updater')

  // Downloading is automatic; INSTALLING never is. Nothing in this module
  // calls quitAndInstall on a timer — only an explicit user click does.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info: { version: string }) => {
    apply({ type: 'update-available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => apply({ type: 'update-not-available' }))
  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    apply({ type: 'download-progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    apply({ type: 'update-downloaded', version: info.version })
  })
  autoUpdater.on('error', (error: Error) => {
    console.warn('[pidex] updater error:', error.message)
    apply({ type: 'error' })
  })
}

/** Check now, on whichever path this install supports. */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  if (canSelfInstall()) await checkWithUpdater()
  else await checkManually()
}

/**
 * Begin periodic checks. Safe to call once from `whenReady`; a no-op in dev,
 * under the E2E stub, and on repeat calls.
 */
export function startUpdateChecks(): void {
  if (started) return
  if (!app.isPackaged) {
    state = { phase: 'unsupported' }
    return
  }
  started = true

  void (async () => {
    if (canSelfInstall()) await wireUpdaterEvents()
    await checkForUpdates()
  })()

  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
  // Update polling must never be the reason the process stays alive.
  timer.unref()
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

/**
 * Apply a staged update, or open the release page when this install cannot
 * apply one itself. Always user-initiated.
 */
export async function restartAndInstall(): Promise<void> {
  if (state.phase === 'manual-download') {
    await shell.openExternal(state.releaseUrl ?? RELEASES_LATEST)
    return
  }
  if (state.phase !== 'downloaded') return
  const { autoUpdater } = await import('electron-updater')
  // isSilent=false so the installer UI shows if the platform has one;
  // isForceRunAfter=true so the user lands back in pidex, not on the desktop.
  autoUpdater.quitAndInstall(false, true)
}
