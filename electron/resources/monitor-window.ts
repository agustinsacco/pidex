import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { clampUiScale } from '@shared/models'
import { getPrefs } from '../store'

/**
 * The floating monitor: a small always-on-top window so resource usage stays
 * visible while the user works in another app.
 *
 * It loads the same renderer bundle with `?view=monitor`, which the app entry
 * reads to render the compact monitor instead of the full UI. That keeps one
 * build and one preload rather than a second HTML entry point.
 */

let monitorWindow: BrowserWindow | null = null

export function openMonitorWindow(isDev: boolean): void {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.show()
    monitorWindow.focus()
    return
  }

  // Same origin as the main window, so Chromium's per-origin zoom applies here
  // too; size the frame to match or the content outgrows it at >100% UI scale.
  const zoom = clampUiScale(getPrefs().fonts.uiScale)

  const window = new BrowserWindow({
    width: Math.round(340 * zoom),
    height: Math.round(460 * zoom),
    minWidth: Math.round(260 * zoom),
    minHeight: Math.round(200 * zoom),
    show: false,
    alwaysOnTop: true,
    // Small utility window: no menu bar, and it should not steal the dock/taskbar
    // slot from the main window.
    skipTaskbar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1c18',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Visible on top of full-screen apps too, which is the point of the float.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    monitorWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL!}?view=monitor`)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: { view: 'monitor' },
    })
  }

  monitorWindow = window
}

export function closeMonitorWindow(): void {
  if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.close()
  monitorWindow = null
}

/** True while the floating window is open (drives the toggle's state). */
export function isMonitorWindowOpen(): boolean {
  return monitorWindow !== null && !monitorWindow.isDestroyed()
}
