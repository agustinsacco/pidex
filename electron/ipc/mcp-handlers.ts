import { handle } from './handle'
import {
  readMcpCache,
  readMcpConfigs,
  readMcpFile,
  removeMcpServer,
  setMcpServerDisabled,
  upsertMcpServer,
  writeMcpFile,
} from '../pi/mcp-config'

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
}
