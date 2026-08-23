import { registerPiSessionHandlers } from './ipc/pi-session-handlers'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerClipboardHandlers } from './ipc/clipboard-handlers'
import { registerPiConfigHandlers } from './ipc/pi-config-handlers'
import { registerPiAuthHandlers } from './ipc/pi-auth-handlers'
import { registerSessionsHandlers } from './ipc/sessions-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerPtyHandlers } from './ipc/pty-handlers'
import { registerMcpHandlers } from './ipc/mcp-handlers'
import { registerPackagesHandlers } from './ipc/packages-handlers'
import { registerResourceHandlers } from './ipc/resources-handlers'
import { registerUpdateHandlers } from './ipc/updates-handlers'
import { configureMonitor } from './resources/monitor'
import { registry } from './registry'
import { ptyManager } from './pty/pty-manager'

/**
 * Register every IPC invoke handler, grouped by domain.
 *
 * Called once from main.ts on `app.whenReady()`. Each registrar owns one
 * channel prefix, so a new handler has exactly one obvious home.
 */
export function registerIpcHandlers(isDev: boolean): void {
  // Teach the monitor how to find live sessions and their terminals. Injected
  // here (the composition root) so `resources/` imports no registry directly.
  configureMonitor(() => {
    const terminalPids = ptyManager.pidsBySession()
    return registry.list().map((session) => ({
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
      piPid: session.pid,
      terminalPids: terminalPids.get(session.sessionId) ?? [],
    }))
  })

  registerPiSessionHandlers()
  registerAppHandlers()
  registerClipboardHandlers()
  registerPiConfigHandlers()
  registerPiAuthHandlers()
  registerSessionsHandlers()
  registerGitHandlers()
  registerFsHandlers()
  registerPtyHandlers()
  registerMcpHandlers()
  registerPackagesHandlers()
  registerResourceHandlers(isDev)
  registerUpdateHandlers()
}
