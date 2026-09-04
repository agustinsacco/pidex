import { handle } from './handle'
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { shell } from 'electron'
import type { ConnectorAuthState } from '@shared/models'
import {
  readMcpCache,
  readMcpConfigs,
  readMcpFile,
  removeMcpServer,
  setMcpServerDisabled,
  upsertMcpServer,
  writeMcpFile,
} from '../pi/mcp-config'
import {
  cancelConnectorAuth,
  startConnectorAuth,
  submitConnectorCallback,
} from '../pi/connector-auth'
import { checkPiHealth } from '../pi/health'
import { piProcessEnv } from '../pi/shell-env'
import { piStubPath } from '../pi/stub'
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Open the adapter's authorization page.
 *
 * The URL comes out of an extension's prompt text, so it is validated exactly
 * as `app:openExternal` validates a renderer-supplied one: http/https only,
 * never a custom scheme that would hand a local handler an argument. Failing
 * closed still leaves the URL visible in the connector card.
 */
function openAuthPage(url: string): void {
  // E2E drives the stub's fake authorization URL; launching a real browser from
  // CI would be noise at best. Gated on the stub, which is itself gated on
  // `!app.isPackaged`.
  if (piStubPath()) return
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    void shell.openExternal(parsed.toString())
  } catch {
    /* unparseable — the card still shows the raw URL */
  }
}

/** mcp.json chain management for the pi-mcp-adapter (Settings → MCP). */
export function registerMcpHandlers(): void {
  handle('mcp:readConfigs', (_event, workspacePath) => readMcpConfigs(workspacePath))

  handle('mcp:upsertServer', (_event, scope, workspacePath, name, config) =>
    upsertMcpServer(scope, workspacePath, name, config),
  )

  handle('mcp:removeServer', (_event, scope, workspacePath, name) =>
    removeMcpServer(scope, workspacePath, name),
  )

  handle('mcp:setDisabled', (_event, scope, workspacePath, name, disabled) =>
    setMcpServerDisabled(scope, workspacePath, name, disabled),
  )

  handle('mcp:readCache', () => readMcpCache())

  handle('mcp:readFile', (_event, scope, workspacePath) => readMcpFile(scope, workspacePath))

  handle('mcp:writeFile', (_event, scope, workspacePath, content) =>
    writeMcpFile(scope, workspacePath, content),
  )

  handle('mcp:authorize', async (_event, serverName, workspacePath) => {
    const stub = piStubPath()
    const emit = (state: ConnectorAuthState): void =>
      broadcast('mcp:authState', { serverName, state })

    // Resolved here rather than inside the flow so the flow module stays
    // spawn-agnostic and testable against a fake pi.
    const binaryPath = stub ? process.execPath : (await checkPiHealth()).binaryPath
    if (!binaryPath) {
      emit({ phase: 'failed', message: 'pi is not available.' })
      return
    }

    // A connector without a workspace is legitimate: Settings is reachable
    // from the home screen. Home is the safest cwd — it resolves the global
    // mcp.json chain and no project-scope file.
    void startConnectorAuth({
      serverName,
      cwd: workspacePath ?? homedir(),
      binaryPath,
      ...(stub ? { prefixArgs: [stub] } : {}),
      env: stub ? { ELECTRON_RUN_AS_NODE: '1' } : await piProcessEnv(),
      onState: emit,
      openUrl: openAuthPage,
    })
  })

  handle('mcp:submitAuthCallback', (_event, serverName, url) =>
    submitConnectorCallback(serverName, url),
  )

  handle('mcp:cancelAuth', (_event, serverName) => cancelConnectorAuth(serverName))
}
