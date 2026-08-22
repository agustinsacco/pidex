import { app, BrowserWindow, dialog, shell } from 'electron'
import { basename } from 'node:path'
import { access } from 'node:fs/promises'
import { handle } from './handle'
import { applyTitleBarOverlay, applyZoom } from '../window-chrome'
import { userInfo } from 'node:os'
import {
  getPrefs,
  markSessionSeen,
  recordWorkspace,
  setCollapsedWorkspaces,
  setClaudeSystemPrompt,
  setFontPrefs,
  setLastSession,
  setPinnedSessions,
  setRecentWorkspaces,
  setTheme,
} from '../store'

/**
 * E2E hook: skip the native (undriveable) folder picker.
 *
 * Gated on `!app.isPackaged` for the same reason as PIDEX_PI_STUB — a shipped
 * app must not let an environment variable choose the workspace.
 */
function e2eWorkspaceOverride(): string | undefined {
  if (app.isPackaged) return undefined
  return process.env.PIDEX_E2E_WORKSPACE || undefined
}

/** True when the path is reachable — used to validate persisted locations. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** App preferences, native dialogs, and runtime info. */
export function registerAppHandlers(): void {
  handle('app:getPrefs', () => getPrefs())

  handle('app:setTheme', (_event, theme) => {
    setTheme(theme)
    // The OS-drawn window controls do not follow the page theme on their own.
    applyTitleBarOverlay(theme)
  })

  handle('app:setPinnedSessions', (_event, paths) => {
    setPinnedSessions(paths)
  })

  handle('app:setLastSession', (_event, sessionPath) => {
    setLastSession(sessionPath)
  })

  handle('app:setCollapsedWorkspaces', (_event, paths) => {
    setCollapsedWorkspaces(paths)
  })

  handle('app:recordWorkspace', (_event, path: string) => {
    recordWorkspace(path, basename(path))
  })

  handle('app:resumeTarget', async () => {
    const { lastSessionPath, lastWorkspacePath, recentWorkspaces } = getPrefs()

    // Prefer the exact session, but only if BOTH it and its workspace still
    // exist — a session file whose folder was deleted can't be resumed.
    if (lastSessionPath && lastWorkspacePath) {
      const [sessionOk, workspaceOk] = await Promise.all([
        pathExists(lastSessionPath),
        pathExists(lastWorkspacePath),
      ])
      if (sessionOk && workspaceOk) {
        return {
          kind: 'session' as const,
          sessionPath: lastSessionPath,
          workspacePath: lastWorkspacePath,
        }
      }
    }

    if (lastWorkspacePath && (await pathExists(lastWorkspacePath))) {
      return { kind: 'workspace' as const, workspacePath: lastWorkspacePath }
    }

    // Fall back to the newest recent that still exists — the picker should
    // only ever appear on a true first run, not because lastWorkspacePath
    // went stale or was never written.
    for (const ws of [...recentWorkspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)) {
      if (await pathExists(ws.path)) {
        return { kind: 'workspace' as const, workspacePath: ws.path }
      }
    }

    return { kind: 'none' as const }
  })

  handle('app:setClaudeSystemPrompt', (_event, mode) => {
    setClaudeSystemPrompt(mode)
  })

  handle('app:setFontPrefs', (_event, fonts) => {
    setFontPrefs(fonts)
    // UI scale is page zoom (see window-chrome.applyZoom); it has to be stored
    // before this call, which reads the prefs back to resize the OS overlay.
    applyZoom(fonts.uiScale)
  })

  handle('app:setRecentWorkspaces', (_event, workspaces) => {
    setRecentWorkspaces(workspaces)
  })

  handle('app:markSessionSeen', (_event, sessionPath: string) => {
    markSessionSeen(sessionPath)
  })

  handle('app:userInfo', () => ({
    username: userInfo().username,
    // Only the profile NAME, never credentials — used to build the right
    // `aws sso login --profile …` suggestion when a token expires.
    awsProfile: process.env.AWS_PROFILE || undefined,
  }))

  handle('app:about', () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }))

  handle('app:selectFolder', async (event) => {
    // E2E hook: avoid the native (undriveable) dialog.
    const override = e2eWorkspaceOverride()
    if (override) return override
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open Workspace Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  handle('app:getPathForDisplay', (_event, path: string) => basename(path))

  handle('app:saveDialog', async (event, options) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(window!, {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    return result.canceled ? null : (result.filePath ?? null)
  })

  handle('app:revealPath', (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  // http(s) only. The URL originates from `gh` output, so it is not attacker
  // controlled today, but shell.openExternal will happily launch file:// or a
  // registered custom scheme — a URL string must never be able to do that.
  handle('app:openExternal', async (_event, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    await shell.openExternal(parsed.toString())
  })
}
