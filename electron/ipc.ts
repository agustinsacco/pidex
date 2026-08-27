import { registerPiSessionHandlers } from './ipc/pi-session-handlers'
import { registerAppHandlers, registerDebugLogHandlers } from './ipc/app-handlers'
import { registerClipboardHandlers } from './ipc/clipboard-handlers'
import { registerPiConfigHandlers } from './ipc/pi-config-handlers'
import { registerPiAuthHandlers } from './ipc/pi-auth-handlers'
import { registerSessionsHandlers } from './ipc/sessions-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerPtyHandlers } from './ipc/pty-handlers'
import { registerMcpHandlers } from './ipc/mcp-handlers'
import { registerPackagesHandlers } from './ipc/packages-handlers'
import { registerUpdateHandlers } from './ipc/updates-handlers'
import { registerOrchestratorHandlers } from './ipc/orchestrator-handlers'

/**
 * Register every IPC invoke handler, grouped by domain.
 *
 * Called once from main.ts on `app.whenReady()`. Each registrar owns one
 * channel prefix, so a new handler has exactly one obvious home.
 */
export function registerIpcHandlers(): void {
  // First: it starts the fleet hub and teaches the orchestrator how to spawn,
  // both of which the orchestrator handlers below assume are in place.
  registerPiSessionHandlers()
  registerOrchestratorHandlers()
  registerAppHandlers()
  registerDebugLogHandlers()
  registerClipboardHandlers()
  registerPiConfigHandlers()
  registerPiAuthHandlers()
  registerSessionsHandlers()
  registerGitHandlers()
  registerFsHandlers()
  registerPtyHandlers()
  registerMcpHandlers()
  registerPackagesHandlers()
  registerUpdateHandlers()
}
