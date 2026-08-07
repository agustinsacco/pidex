import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { registry } from './registry'
import { ptyManager } from './pty/pty-manager'
import { unwatchAll } from './pi/session-watcher'
import { unwatchAllWorkspaces } from './fs/workspace-watcher'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Brand identity when running unpackaged (`npm run dev`): packaged builds get
// name + icon from electron-builder (productName / build/icon.*), but a dev
// run is the stock Electron.app, so macOS shows the Electron dock icon and
// the switcher says "Electron". The dock icon is fixable at runtime; the
// menu-bar/switcher *title* is read from Electron.app's Info.plist and is not
// — only a packaged build shows "pidex" there.
app.setName('pidex')
const devIcon = !app.isPackaged ? join(app.getAppPath(), 'build/icon.png') : undefined

// E2E runs must never touch the developer's real prefs. Tests that need
// state to survive a relaunch (e.g. "reopens the last session") pin the
// directory explicitly; everything else gets a per-pid scratch dir. Gated on
// packaging so the env var cannot redirect a shipped app's user data
// (see ipc/pi-session-handlers.ts:piStubPath).
if (!app.isPackaged && process.env.PIDEX_TEST_USER_DATA) {
  const dir =
    process.env.PIDEX_TEST_USER_DATA !== '1'
      ? process.env.PIDEX_TEST_USER_DATA
      : join(app.getPath('temp'), `pidex-e2e-${process.pid}`)
  app.setPath('userData', dir)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f7f6f2',
    // Window/taskbar icon for unpackaged linux runs (packaged linux resolves
    // it from the desktop entry; macOS ignores this option).
    ...(devIcon && process.platform === 'linux' ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.on('ready-to-show', () => window.show())

  // External links open in the default browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  if (devIcon && process.platform === 'darwin') {
    app.dock?.setIcon(devIcon)
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  // Clean shutdown: SIGTERM to every pi child, kill all PTYs, close all
  // filesystem watchers so no chokidar handles or debounce timers outlive us.
  ptyManager.killAll()
  void Promise.allSettled([registry.disposeAll(), unwatchAll(), unwatchAllWorkspaces()]).finally(
    () => app.quit(),
  )
})
