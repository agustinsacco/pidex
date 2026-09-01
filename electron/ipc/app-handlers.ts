import { app, BrowserWindow, dialog, shell } from 'electron'
import { basename } from 'node:path'
import { access } from 'node:fs/promises'
import { handle } from './handle'
import { stageArtifactHtml } from '../artifacts/artifact-protocol'
import { applyTitleBarOverlay, applyZoom } from '../window-chrome'
import { debugLogPath } from '../debug-log'
import { userInfo } from 'node:os'
import {
  deleteDraftBlobs,
  listDraftBlobs,
  readDraftBlob,
  wouldExceedBlobCap,
  writeDraftBlob,
} from '../drafts-blobs'
import { orphanBlobIds, sweepDrafts } from '../prefs-utils'
import {
  getPrefs,
  markSessionSeen,
  recordWorkspace,
  setCollapsedWorkspaces,
  setFontPrefs,
  setLastSession,
  setModelPicks,
  setLaneMarkers,
  setLanePrefs,
  setPinnedSessions,
  setRecentWorkspaces,
  setTheme,
  setAgentDirectives,
  setWorktreePrefs,
  setNotificationsMuted,
  setClaudeAutocompact,
  setSessionReaperPrefs,
  setDraft,
  clearDraft,
  setDrafts,
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

  handle('artifacts:stageHtml', (_event, html: string) => stageArtifactHtml(html))

  handle('app:setLanePrefs', (_event, lanes) => {
    setLanePrefs(lanes)
  })

  handle('app:setLaneMarkers', (_event, markers) => {
    setLaneMarkers(markers)
  })

  handle('app:setModelPicks', (_event, picks) => {
    setModelPicks(picks)
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

  handle('app:setDraft', async (_event, draft) => {
    // Anything the prune dropped takes its images with it.
    await deleteDraftBlobs(setDraft(draft))
  })

  handle('app:clearDraft', async (_event, key) => {
    await deleteDraftBlobs(clearDraft(key))
  })

  handle('app:writeDraftBlob', async (_event, blobId, base64) => {
    // Refuse rather than silently drop: the composer says so out loud.
    const bytes = Math.floor((base64.length * 3) / 4)
    if (await wouldExceedBlobCap(bytes)) return false
    await writeDraftBlob(blobId, base64)
    return true
  })

  handle('app:readDraftBlob', (_event, blobId) => readDraftBlob(blobId))

  handle('app:sweepDrafts', async () => {
    const drafts = getPrefs().drafts
    // Resolve existence up front: `sweepDrafts` is pure so it can be tested
    // without a filesystem.
    const folders = [...new Set(Object.keys(drafts).filter((k) => k.startsWith('home:')))].map(
      (k) => k.slice('home:'.length),
    )
    const alive = new Set(
      (await Promise.all(folders.map(async (f) => ((await pathExists(f)) ? f : null)))).filter(
        (f): f is string => f !== null,
      ),
    )
    const swept = sweepDrafts(drafts, (path) => alive.has(path))
    setDrafts(swept.drafts)
    const orphans = orphanBlobIds(swept.drafts, await listDraftBlobs())
    await deleteDraftBlobs([...swept.dropped, ...orphans])
    return swept.drafts
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

  handle('app:setFontPrefs', (_event, fonts) => {
    setFontPrefs(fonts)
    // UI scale is page zoom (see window-chrome.applyZoom); it has to be stored
    // before this call, which reads the prefs back to resize the OS overlay.
    applyZoom(fonts.uiScale)
  })

  handle('app:setRecentWorkspaces', (_event, workspaces) => {
    setRecentWorkspaces(workspaces)
  })

  handle('app:setWorktreePrefs', (_event, worktrees) => {
    setWorktreePrefs(worktrees)
  })

  handle('app:setAgentDirectives', (_event, directives, projectPath) => {
    setAgentDirectives(directives, projectPath)
  })

  handle('app:setNotificationsMuted', (_event, muted: boolean) => {
    setNotificationsMuted(muted)
  })

  handle('app:setClaudeAutocompact', (_event, value: string) => {
    setClaudeAutocompact(value)
  })

  handle('app:setSessionReaperPrefs', (_event, prefs) => {
    setSessionReaperPrefs(prefs)
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

/**
 * Debug-log access.
 *
 * Registered here rather than behind a dev flag: the log exists to explain a
 * failure that already happened, so the path must be reachable from a shipped
 * build without first turning something on.
 */
export function registerDebugLogHandlers(): void {
  handle('app:debugLogPath', () => debugLogPath())
  handle('app:revealDebugLog', () => {
    const path = debugLogPath()
    if (path) shell.showItemInFolder(path)
  })
}
