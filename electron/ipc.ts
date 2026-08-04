import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join as joinPath } from 'node:path'
import { userInfo } from 'node:os'
import { checkPiHealth } from './pi/health'
import { SessionRegistry } from './pi/session-registry'
import { listWorkspaceFiles } from './fs/list-files'
import {
  checkAgentSettings,
  listCatalogueModels,
  listPiResources,
  patchAgentSettings,
  readAgentSettings,
  readConfigFile,
  writeConfigFile,
} from './pi/agent-settings'
import { piProcessEnv } from './pi/shell-env'
import { listSessions, readSessionTree, workspaceStats } from './pi/session-scanner'
import { watchWorkspaceSessions } from './pi/session-watcher'
import { appendBranchJump, appendLabel, forkSessionAt } from './pi/session-writer'
import { gitInfo } from './fs/git-info'
import { createSessionBaseline, gitStatusMap, restoreFileTo, showFileAt } from './fs/git-service'
import {
  createDir,
  createFile,
  listDir,
  readTextFile,
  renamePath,
  writeTextFile,
} from './fs/fs-service'
import { watchWorkspace } from './fs/workspace-watcher'
import { ptyManager } from './pty/pty-manager'
import {
  getPrefs,
  recordWorkspace,
  setFontPrefs,
  setLastSession,
  setPinnedSessions,
  setRecentWorkspaces,
  setTheme,
} from './store'
import { access } from 'node:fs/promises'

/** True when the path is reachable — used to validate persisted locations. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
import { sessionEventChannel, type IpcInvokeChannel, type IpcInvokeMap } from '@shared/ipc'
import {
  MIN_PI_VERSION,
  type CreateSessionOptions,
  type PiHealth,
  type SessionPush,
} from '@shared/models'
import type { ExtensionUIResponse, RpcCommand } from '@shared/rpc'

export const registry = new SessionRegistry()

let cachedHealth: PiHealth | null = null

/** Bundled pidex pi extension (dev: repo path; packaged: resources). */
function artifactsExtensionPath(): string {
  if (app.isPackaged) {
    return joinPath(process.resourcesPath, 'pi-ext', 'artifacts.ts')
  }
  return joinPath(app.getAppPath(), 'pi-ext', 'artifacts.ts')
}

/**
 * E2E hook: PIDEX_PI_STUB points at a script that speaks the RPC protocol in
 * place of the real pi binary, so CI can smoke-test without an API key.
 * Never set in normal use.
 */
function piStubPath(): string | undefined {
  return process.env.PIDEX_PI_STUB || undefined
}

type Handler<C extends IpcInvokeChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']

function handle<C extends IpcInvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

export function registerIpcHandlers(): void {
  handle('pi:health', async () => {
    if (piStubPath()) {
      return {
        ok: true,
        binaryPath: piStubPath(),
        version: MIN_PI_VERSION,
        minVersion: MIN_PI_VERSION,
      }
    }
    if (!cachedHealth || !cachedHealth.ok) cachedHealth = await checkPiHealth()
    return cachedHealth
  })

  handle('pi:createSession', async (event, options: CreateSessionOptions) => {
    const stub = piStubPath()
    let binaryPath: string | undefined
    let prefixArgs: string[] | undefined

    if (stub) {
      binaryPath = process.execPath
      prefixArgs = [stub]
    } else {
      const health = cachedHealth?.ok ? cachedHealth : (cachedHealth = await checkPiHealth())
      if (!health.ok) throw new Error(health.message ?? 'pi is not available')
      binaryPath = health.binaryPath
    }

    // pi is a `#!/usr/bin/env node` script: it needs the login shell's PATH
    // to find node under a version manager, not the GUI-inherited one.
    const spawnEnv = stub ? { ELECTRON_RUN_AS_NODE: '1' } : await piProcessEnv()

    const session = registry.create(options.workspacePath, {
      binaryPath,
      prefixArgs,
      sessionPath: options.sessionPath,
      forkFrom: options.forkFrom,
      name: options.name,
      model: options.model,
      provider: options.provider,
      thinkingLevel: options.thinkingLevel,
      // The bundled artifacts extension rides along in every session.
      ...(stub ? {} : { extensions: [artifactsExtensionPath()] }),
      env: spawnEnv,
    })

    const contents = event.sender
    const channel = sessionEventChannel(session.sessionId)
    const push = (payload: SessionPush): void => {
      if (!contents.isDestroyed()) contents.send(channel, payload)
    }

    session.client.on('event', (ev) => push({ kind: 'event', event: ev }))
    session.client.on('extension-ui', (request) => push({ kind: 'extension-ui', request }))
    session.client.on('stderr', (text) => push({ kind: 'stderr', text }))
    session.client.on('exit', ({ code, signal, expected }) =>
      push({ kind: 'exit', code, signal: signal ?? null, expected }),
    )

    recordWorkspace(options.workspacePath, basename(options.workspacePath))
    return {
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
      pid: session.client.pid,
    }
  })

  handle('pi:command', async (_event, sessionId: string, command: RpcCommand) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session.client.request(command)
  })

  handle('pi:extensionUiResponse', (_event, sessionId: string, response: ExtensionUIResponse) => {
    const session = registry.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    session.client.respondToExtensionUI(response)
  })

  handle('pi:disposeSession', async (_event, sessionId: string) => {
    await registry.dispose(sessionId)
  })

  handle('pi:listLiveSessions', () => registry.list())

  handle('app:getPrefs', () => getPrefs())

  handle('app:setTheme', (_event, theme) => {
    setTheme(theme)
  })

  handle('app:setPinnedSessions', (_event, paths) => {
    setPinnedSessions(paths)
  })

  handle('app:setLastSession', (_event, sessionPath) => {
    setLastSession(sessionPath)
  })

  handle('app:resumeTarget', async () => {
    const { lastSessionPath, lastWorkspacePath } = getPrefs()

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

    return { kind: 'none' as const }
  })

  handle('app:setFontPrefs', (_event, fonts) => {
    setFontPrefs(fonts)
  })

  handle('app:setRecentWorkspaces', (_event, workspaces) => {
    setRecentWorkspaces(workspaces)
  })

  handle('app:userInfo', () => ({ username: userInfo().username }))

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
    if (process.env.PIDEX_E2E_WORKSPACE) return process.env.PIDEX_E2E_WORKSPACE
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

  handle('fs:listFiles', (_event, workspacePath: string) => listWorkspaceFiles(workspacePath))

  handle('pi:agentSettings', (_event, workspacePath?: string) => readAgentSettings(workspacePath))

  handle('pi:catalogueModels', () => listCatalogueModels())

  handle('pi:readConfigFile', (_event, name) => readConfigFile(name))

  handle('pi:writeConfigFile', (_event, name, content) => writeConfigFile(name, content))

  handle('pi:patchAgentSettings', (_event, scope, workspacePath, patch) =>
    patchAgentSettings(scope, workspacePath, patch),
  )

  handle('pi:checkAgentSettings', async (_event, workspacePath?: string) => {
    const result = await checkAgentSettings(workspacePath)
    // Don't ship parsed contents over IPC — only the health of each file.
    const strip = (r: { exists: boolean; malformed: boolean; error?: string } | null) =>
      r ? { exists: r.exists, malformed: r.malformed, error: r.error } : null
    return { global: strip(result.global)!, project: strip(result.project) }
  })

  handle('pi:listResources', () => listPiResources())

  handle('sessions:list', (_event, workspacePath: string) => listSessions(workspacePath))

  handle('sessions:stats', (_event, workspacePath: string) => workspaceStats(workspacePath))

  handle('sessions:watch', (_event, workspacePath: string) => {
    watchWorkspaceSessions(workspacePath)
  })

  handle('sessions:delete', async (_event, sessionFilePath: string) => {
    await shell.trashItem(sessionFilePath)
  })

  handle('sessions:readTree', (_event, sessionFilePath: string) => readSessionTree(sessionFilePath))

  handle('sessions:appendLabel', async (_event, sessionFilePath, targetId, label) => {
    await appendLabel(sessionFilePath, targetId, label)
  })

  handle('sessions:jump', async (_event, sessionFilePath, targetId) => {
    await appendBranchJump(sessionFilePath, targetId)
  })

  handle('sessions:forkAt', (_event, sessionFilePath, targetId) =>
    forkSessionAt(sessionFilePath, targetId),
  )

  handle('git:info', (_event, workspacePath: string) => gitInfo(workspacePath))

  handle('git:statusMap', (_event, workspacePath: string) => gitStatusMap(workspacePath))

  handle('git:sessionBaseline', (_event, workspacePath: string) =>
    createSessionBaseline(workspacePath),
  )

  handle('git:showFileAt', (_event, workspacePath, ref, relativePath) =>
    showFileAt(workspacePath, ref, relativePath),
  )

  handle('git:restoreFileTo', (_event, workspacePath, ref, relativePath) =>
    restoreFileTo(workspacePath, ref, relativePath),
  )

  handle('fs:readDir', (_event, workspacePath, dirPath, options) =>
    listDir(workspacePath, dirPath, options),
  )

  handle('fs:readFile', (_event, path) => readTextFile(path))

  handle('fs:writeFile', (_event, path, content) => writeTextFile(path, content))

  handle('fs:createFile', (_event, path) => createFile(path))

  handle('fs:createDir', (_event, path) => createDir(path))

  handle('fs:rename', (_event, from, to) => renamePath(from, to))

  handle('fs:trash', async (_event, path) => {
    await shell.trashItem(path)
  })

  handle('fs:watchWorkspace', (_event, workspacePath) => {
    watchWorkspace(workspacePath)
  })

  handle('pty:create', (_event, workspacePath, cols, rows) =>
    ptyManager.create(workspacePath, cols, rows),
  )

  handle('pty:write', (_event, ptyId, data) => {
    ptyManager.write(ptyId, data)
  })

  handle('pty:resize', (_event, ptyId, cols, rows) => {
    ptyManager.resize(ptyId, cols, rows)
  })

  handle('pty:kill', (_event, ptyId) => {
    ptyManager.kill(ptyId)
  })
}
