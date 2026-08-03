import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename } from 'node:path'
import { checkPiHealth } from './pi/health'
import { SessionRegistry } from './pi/session-registry'
import { listWorkspaceFiles } from './fs/list-files'
import { readAgentSettings } from './pi/agent-settings'
import { getPrefs, recordWorkspace, setTheme } from './store'
import { sessionEventChannel, type IpcInvokeChannel, type IpcInvokeMap } from '@shared/ipc'
import type { CreateSessionOptions, PiHealth, SessionPush } from '@shared/models'
import type { ExtensionUIResponse, RpcCommand } from '@shared/rpc'

export const registry = new SessionRegistry()

let cachedHealth: PiHealth | null = null

type Handler<C extends IpcInvokeChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']

function handle<C extends IpcInvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}

export function registerIpcHandlers(): void {
  handle('pi:health', async () => {
    if (!cachedHealth || !cachedHealth.ok) cachedHealth = await checkPiHealth()
    return cachedHealth
  })

  handle('pi:createSession', async (event, options: CreateSessionOptions) => {
    const health = cachedHealth?.ok ? cachedHealth : (cachedHealth = await checkPiHealth())
    if (!health.ok) throw new Error(health.message ?? 'pi is not available')

    const session = registry.create(options.workspacePath, {
      binaryPath: health.binaryPath,
      sessionPath: options.sessionPath,
      forkFrom: options.forkFrom,
      name: options.name,
      model: options.model,
      provider: options.provider,
      thinkingLevel: options.thinkingLevel,
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

  handle('app:selectFolder', async (event) => {
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
}
